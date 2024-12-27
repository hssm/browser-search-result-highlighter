def parse_search(search):
    terms = get_search_terms(search)
    return extract_searchable_terms(terms)


# Split search string by search terms
def get_search_terms(search):
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
        if term.lower().startswith('nc:'):
            extracted.append(term[3:])
        elif term[0] == '-':
            pass
        elif ':' in term:
            pass
        elif term.lower() == 'or' or term.lower() == 'and':
            pass
        elif term[0] == '(' and term[-1] == ')':
            inner_terms = get_search_terms(term[1:-1])
            extracted.extend(extract_searchable_terms(inner_terms))
        elif term[0] in ["'", '"']:
            if len(term) > 1:
                # We will permit "and" and "or" as special cases
                if term[1:-1].lower() in ['and', 'or']:
                    extracted.append(term[1:-1])
                else:
                    extracted.extend(extract_searchable_terms([term[1:-1]]))
        else:
            extracted.append(term)
    return extracted
