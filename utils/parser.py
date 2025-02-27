import re


def parse_search(search):
    nodes = parse_nodes(search)
    terms = extract_searchable_terms(nodes)
    return build_payload_from_terms(terms)

# Split search string by search terms
def parse_nodes(search):
    terms = []

    start = 0
    close = None
    level = 1
    backtrack = 0
    idx = -1
    for c in search:
        idx += 1
        # We're looking for a terminator
        if close:
            s_from = None
            s_to = None

            if close == ')' and c == '(':
                level += 1
                continue
            if close == ')' and c == ')':
                level -= 1
                if level > 0:
                    continue

            if ((c == '"' and close == '"')
                    or (c == "'" and close == "'")
                    or (c == ')' and close == ')')):
                close = None
                s_from = start
                s_to = idx+1
            if c == '"' and close == '\\s':
                close = '"'
                continue
            if c == '(' and close == '\\s':
                close = ')'
                continue
            elif c.isspace() and close == '\\s':
                close = None
                s_from = start
                s_to = idx
            # End of string. Force capture
            if idx == len(search)-1:
                close = None
                s_from = start
                s_to = idx+1

            # We captured a term
            if not close:
                terms.append(search[s_from-backtrack:s_to])
                start = idx+1
                backtrack = 0
                level = 1
        else:
            # We're looking for the beginning of a term
            if c == '"':
                close = '"'
            elif c == "'":
                close = "'"
            elif c == '(':
                close = ')'
            elif c == '-':
                backtrack += 1
                continue
            elif not c.isspace():
                close = '\\s'

            # We've started a capture
            if close:
                start = idx
                if idx == len(search) - 1:
                    # Capture started at end of string (single char term). Force capture.
                    terms.append(search[start:idx+1])
    return terms


# Pick out only the terms that result in a search of field string content.
# If the term is a (grouping) term, recursively extract terms from that too
def extract_searchable_terms(terms):
    extracted = []
    for term in terms:
        if not term:
            continue

        if term[0] == '-':
            continue
        elif term.lower() == 'or' or term.lower() == 'and':
            continue
        elif term[0] == '(' and term[-1] == ')':
            inner_terms = parse_nodes(term[1:-1])
            extracted.extend(extract_searchable_terms(inner_terms))
            continue
        elif term[0] in ["'", '"']:
            if len(term) > 1:
                if ':' in term and term[term.index(':') - 1] != '\\':
                    pass
                else:
                    if term[1:-1].lower() in ['and', 'or']:
                        extracted.append({'tag': 'normal', 'term': term[1:-1]})
                    elif term[1] == '(' and term[-2] == ')':
                        extracted.append({'tag': 'quoted', 'term': term[1:-1]})
                    else:
                        if len(term) > 1 and term[0] == '"' and term[-1] == '"':
                            term = term[1:-1]
                        extracted.append({'tag': 'quoted', 'term': term})
                    continue
        if ':' in term and term[term.index(':') - 1] != '\\':
            if len(term) > 1 and term[0] == '"' and term[-1] == '"':
                term = term[1:-1]
            prefix, main = term.split(':', 1)
            prefix = prefix.lower()
            if prefix in ignore:
                continue
            elif prefix == 'w':
                if len(main) > 1 and main[0] == '"' and main[-1] == '"':
                    main = main[1:-1]
                extracted.append({'tag': 'boundary', 'term': main})
            elif prefix == 're':
                flags = 'igu'
                if main.lower().startswith('(?-i)'):
                    main = main[5:]
                    flags = 'gu'
                extracted.append({'tag': 'regex', 'flags': flags, 'term': main})
            elif prefix == 'nc':
                extracted.append({'tag': 'noncombining', 'term': main})
            elif prefix == 'tag':
                if main.lower().startswith('re:'):
                    main = main[3:]
                    extracted.append({'tag': 'tag', 'regex': True, 'term': main})
                else:
                    extracted.append({'tag': 'tag', 'regex': False, 'term': main})
            else:
                extracted.append({'tag': 'field', 'field_name': prefix.lower(), 'term': extract_searchable_terms([main])})
        else:
            extracted.append({'tag': 'normal', 'term': term})
    return extracted

def replace_special(term):
    if '_' in term:
        index = term.index('_')
        if index == 0 or term[index - 1] != '\\':
            term = term.replace('_', '.')
    if '*' in term:
        index = term.index('*')
        if index == 0 or term[index - 1] != '\\':
            term = term.replace('*', '.*')
    if '\\:' in term:
        term = term.replace('\\:', ':')

    term = re.escape(term)

    if '\\\\' in term:
        term = term.replace('\\\\', '\\')

    term = term.replace('\\.', '.')
    term = term.replace('\\*', '*')
    term = term.replace('\\&amp;', r'\&')
    term = term.replace('\\&lt;', '<')
    term = term.replace('\\&gt;', '>')
    return term

def replace_special_tags(term, regex=False):
    if not regex:
        term = term.replace('*', '.*')
    term = term.replace('::', '∷')
    return term


def build_payload_from_terms(terms):
    out = {
        'normal': [],
        'regex': [],
        'noncomb': [],
        'fields': [],
        'tags': []
    }

    specials = True
    for node in terms:
        if isinstance(node['term'], list):
            node['term'] = build_payload_from_terms(node['term'])
            # Already handled from above call. Avoid doing it again
            specials = False

        if specials and node['tag'] != 'regex' and node['tag'] != 'tag':
            node['term'] = replace_special(node['term'])

        if node['tag'] == 'normal':
            out['normal'].append(node['term'])
        if node['tag'] == 'boundary':
            out['normal'].append(r'\b' + node['term'] + r'\b')
        if node['tag'] == 'quoted':
            out['normal'].append(node['term'])
        if node['tag'] == 'field':
            out['fields'].append({'name': replace_special(node['field_name']), 'terms': node['term']})
        if node['tag'] == 'regex':
            out['regex'].append({'term': node['term'], 'flags': node['flags']})
        if node['tag'] == 'noncombining':
            out['noncomb'].append(node['term'])
        if node['tag'] == 'tag':
            node['term'] = replace_special_tags(node['term'], node['regex'])
            out['tags'].append(node['term'])
    return out

ignore = ['deck', 'note', 'card', 'flag', 'resched', 'prop', 'added', 'edited', 'introduced',
          'rated', 'is', 'did', 'mid', 'nid', 'cid', 'dupe', 'has-cd', 'preset']

if __name__ == "__main__":
    from pprint import pprint

    search = 'tag:animal::cat::lion tag:re:^parent$ tag:re:.*ani tag:anim*'
    search = ('re:(?-i)aBCdeF nc:chuán RandomText1 d.g c*t &lt;art&gt; '
              'fRoNt:re:reFRONT front:fff BACK:BACK back:nc:impossible '
              're:MoO RandomText2 tag:t1 tag:TAG2 (cat or (dog and mouse)) '
              're:a OR (re:Ab re:Cd) '
              'nc:x OR (nc:Yz nc:Vw) '
              '"animal front:long text"')
    # search = '"re:(?-i)aBCdeF"'
    # search = '"animal front:long text" aAa "re:(?-i)aBCdeF"'
    search = "fro*:cat *ont:cat f*nt:cat fr_nt:cat F___T:cAt back\\__\\front:cat"
    search = "back\\__\\front:cat back\\to\\___\\future"


    print("Nodes:")
    nodes = parse_nodes(search)
    print(nodes)

    print("Terms:")
    terms = extract_searchable_terms(nodes)
    print(terms)

    print("Payload:")
    payload = build_payload_from_terms(terms)
    pprint(payload)