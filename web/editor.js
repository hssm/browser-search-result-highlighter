// String from python
let terms_str = null;

// Parsed in javascript
let terms_parsed = null;

// Dictionary of regexes to find matches per field. Index is field name.
// The empty string key is applicable to all fields.
let res = null;

// First match found to scroll to
let scroll_to = null;

// Scroll to first match: user toggleable
let auto_scroll = false;

// Number of matches total
let matched_total = 0;

// Number of fields with matches
let matched_fields = 0;

// Number of tags with matches
let matched_tags = 0;

const matchCount = (str, re) => {
  return str?.match(re)?.length ?? 0;
};

// Observer to detect code button/shortcut
const watch = (mutations, observer) => {
    for (let i = 0; i < mutations.length; i++) {
      let mutation = mutations[i];
      if (mutation.addedNodes.length > 0) {
        try {
          let node = mutation.addedNodes[0];
          if (node.classList.contains('CodeMirror-line')) {
            let field_root = node.closest('.editing-area').querySelector('.rich-text-editable').shadowRoot;
            let code_mirror = field_root.host.closest('.editing-area').querySelector('.CodeMirror textarea');

            observer.disconnect();
            code_mirror.addEventListener('focus', codeOnFocus);
            code_mirror.addEventListener('blur', codeOnBlur);
            break;
          }
        } catch (error) {
          // A more precise solution is not worth the effort.
        }
      }
    }
}
let observers = [];

// Observer to detect field area size changes to re-calculate minimap positions
const resizeObserver = new ResizeObserver(entries => {
  for (let entry of entries) {
    fillMinimap();

    if (auto_scroll && scroll_to) {
        scrollToMatch();
    }
  }
});

// UI controls
let controls =
`
<div class="bsrh-controls">
    <span class="match-count-holder">
      <span class="match-count-number">0</span>
      <span class="match-count-text">Matches</span>
    </span>
    <span class="sub-total">
      <span class='field-count-holder'>Fields: <span>0</span></span>
      <span class="separator">❘</span>
      <span class='tag-count-holder'>Tags: <span>0</span></span>
      <span class="separator">❘</span>
      <span class='auto-state-holder'>Scroll:&nbsp; <span onclick='onAuto()'>Off</span></span>
      <span class="settings"></span>
    </span>
</div>
`

let minimap = null;
let scrollarea = null;
let fieldarea = null;
let toolbar = null;

function addControls(auto) {
    auto_scroll = auto;

    // First load has a race condition. Keep trying until element appears.
    let _toolbar = document.querySelector('div[role="toolbar"]');
    if (!_toolbar) {
        setTimeout(() => {addControls(auto)}, 20)
        return;
    }
    _toolbar.insertAdjacentHTML("beforeend", controls);

    // Steal the cog icon and shove it into our own settings button
    let cog = document.querySelector('.floating-reference button span').cloneNode(true);
    _toolbar.querySelector('.bsrh-controls .settings').append(cog);

    // Add the minimap
    let _scrollarea = document.querySelector('.scroll-area-relative');
    _scrollarea.insertAdjacentHTML("beforeend", `<div id="match-minimap"></div>`);

    // Add observers to recalculate minimap positions on height changes
    let _fieldarea = document.querySelector('.scroll-area .fields');
    resizeObserver.observe(_fieldarea);
    resizeObserver.observe(_scrollarea);
    updateControls();

    // Grab elements for later use
    minimap = document.getElementById("match-minimap");
    scrollarea = document.querySelector('.scroll-area');
    fieldarea = _fieldarea;
    toolbar = document.querySelector('.editor-toolbar');
}

function updateControls() {
    let c = document.querySelector('.bsrh-controls');

    // Total matches
    let total_text = matched_total == 1 ? 'Match&nbsp;&nbsp;' : 'Matches';

    c.querySelector('.match-count-number').innerHTML = matched_total;
    c.querySelector('.match-count-text').innerHTML = total_text;
    c.querySelector('.match-count-holder').setAttribute('matched', matched_total > 0);

    // Fields
    c.querySelector('.field-count-holder').setAttribute('matched', matched_fields > 0);
    c.querySelector('.field-count-holder span').innerHTML = matched_fields;

    // Tags
    c.querySelector('.tag-count-holder').setAttribute('matched', matched_tags > 0);
    c.querySelector('.tag-count-holder span').innerHTML = matched_tags;

    // Auto-scroll
    c.querySelector('.auto-state-holder').setAttribute('matched', auto_scroll);
    c.querySelector('.auto-state-holder span').innerHTML = auto_scroll ? 'On' : 'Off';
}

// Consume the python payload containing the search terms
function parseTerms() {
    let payload = JSON.parse(atob(terms_str));

    // Pre-compile all the regexs for better performance and ignore match-none/match-all cases.

    function compile_normals(terms) {
        let out = [];
        terms.forEach(term => {
            if (term.length == 0 || term == ".*") {
                return;
            }
            out.push(new RegExp(term, "gi"));
        })
        return out;
    }
    function compile_regexes(terms) {
        let out = [];
        terms.forEach(term => {
            if (term['term'].length == 0 || term['term'] == ".*") {
                return;
            }
            out.push(new RegExp(term['term'], term['flags']));
        })
        return out;
    }
    function compile_noncombs(terms) {
        let out = [];
        terms.forEach(term => {
            if (term.length == 0 || term == ".*") {
                return;
            }
            let search = term.normalize("NFKD").replace(/\p{M}/gu, '');
            let regex_build = [];
            regex_build.push('\\p{M}*');
            for (let i = 0; i < search.length; i++) {
              regex_build.push(search[i]);
              regex_build.push('\\p{M}*');
            }
            out.push(new RegExp(regex_build.join(''), 'giu'));
        })
        return out;
    }
    function compile_fields(fields) {
        let out = [];
        fields.forEach(field => {
            field['terms'] = {
                'normal': compile_normals(field['terms']['normal']),
                'regex' : compile_regexes(field['terms']['regex']),
                'noncomb': compile_noncombs(field['terms']['noncomb'])
            }
            out.push(field);
        })
        return out;
    }

    terms_parsed = {
        'normal':  compile_normals(payload['normal']),
        'regex': compile_regexes(payload['regex']),
        'noncomb': compile_noncombs(payload['noncomb']),
        'fields': compile_fields(payload['fields']),
        'tags': payload['tags']
    };
}

// Do initial work after note loads.
function beginHighlighter() {
    // Clean slate when switching notes
    CSS.highlights.clear();
    CSS.highlights.set('match', new Highlight());
    CSS.highlights.set('tag', new Highlight());
    CSS.highlights.set('overlap', new Highlight());
    scroll_to = null;
    matched_fields = 0;
    matched_total = 0;
    matched_tags = 0;
    let containers = document.querySelectorAll('.field-container');
    if (containers.length == 0) {
      return;
    }
    containers.forEach((c) => { unhighlightCodeExpander(c); })
    minimap.innerHTML = '';

    // Highlight all fields
    containers.forEach((c) => { highlightField(c, minimap_now=false); })

    // Highlight tags
    highlightTags();

    // Attach observers for the HTML editor (detect when it appears).
    // Clear out the old ones first.
    observers.forEach((o) => { o.disconnect(); })
    observers = [];
    containers.forEach((c) => {
      let observer = new MutationObserver(watch);
      observers.push(observer);
      observer.observe(c, {childList: true, subtree: true});
    })

    // Update UI after matching done
    updateControls();
    fillMinimap();
    if (auto_scroll && scroll_to) {
        // Here's how this is going to work. We scroll to the element immediately.
        scrollToMatch();

        // But the editor contents shift and shuffle for all sorts of reasons, so it may not land
        // on the correct element after all. To solve this, we *keep* scrolling to this element
        // on every resize in the resize observer, but only for the first 500mss.
        setTimeout(() => { scroll_to = false; }, 500);
    }
}

// Highlight a single field
// minimap_now = false turns off minimap building for optimization. Call it manually
// after all fields processed.
function highlightField(container, minimap_now = true) {
    field_name = container.querySelector('.label-name').textContent.toLowerCase();
    let terms = {
        'normal': [...terms_parsed['normal']],
        'regex': [...terms_parsed['regex']],
        'noncomb': [...terms_parsed['noncomb']]
    }

    // For any search term that targets a field name that matches this one, distribute
    // its inner search terms into their respective types
    terms_parsed['fields'].forEach(field => {
        if (new RegExp('^'+field['name']+'$', 'gi').test(field_name)) {
            terms['normal'].push(...field['terms']['normal']);
            terms['regex'].push(...field['terms']['regex']);
            terms['noncomb'].push(...field['terms']['noncomb']);
        }
    });

    let field_root = container.querySelector('.rich-text-editable').shadowRoot;
    let editable = field_root.querySelector('anki-editable');
    let code_mirror = container.querySelector('.CodeMirror textarea');
    if (code_mirror && code_mirror.closest('.plain-text-input').hasAttribute('hidden')) {
        code_mirror = null;
    }

    // Note on counting matches: We count the matches on the text nodes in the field instead of the whole field's
    // editable.textContent because it gives us the same match behaviour as Anki's search. E.g., the field
    // gr<i>ee</i>tings does not match 'greetings', so we won't either, even if a user may expect it to.

    // Track ranges to find overlaps
    let ranges = new Map();

    function highlightWithin(node, regex, normalize=false) {
        let match_count = 0;
        function highlightWithinInner(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                let data = node.data;
                if (normalize) {
                    data = data.normalize("NFKD").replace(/\p{M}/gu, '');
                }
                let matches = [...data.matchAll(regex)];
                matches.forEach((match) => {
                    match_count++;
                    let r = new StaticRange({
                        'startContainer': node,
                        'endContainer': node,
                        'startOffset': match.index,
                        'endOffset': match.index + match[0].length
                    });
                    r.owner = container;
                    CSS.highlights.get('match').add(r);
                    if (scroll_to === null) {
                        scroll_to = r;
                    }
                    if (!ranges.has(node)) {
                        ranges.set(node, []);
                    }
                    ranges.get(node).push([r.startOffset, r.endOffset]);
                });
            } else {
                node.childNodes.forEach(n => highlightWithinInner(n))
            }
        }
        highlightWithinInner(node);
        return match_count;
    }

    function highlightOverlaps() {
        for (let [node, _ranges] of ranges.entries()) {
            let overlaps = new Set();
            for (let i = 0; i < _ranges.length; i++) {
                let n_start = _ranges[i][0];
                let n_end   = _ranges[i][1];
                for (let j = i+1; j < _ranges.length; j++) {
                    let c_start = _ranges[j][0];
                    let c_end   = _ranges[j][1];

                    if (c_end < n_start) {
                        continue;
                    }
                    if (c_start > n_end) {
                        continue;
                    }

                    if (c_start <= n_start) {
                        if (c_end <= n_end) {
                            overlaps.add(JSON.stringify([n_start, c_end]));
                        }
                        if (c_end >= n_end) {
                            overlaps.add(JSON.stringify([n_start, n_end]));
                        }
                    }
                    if (c_start >= n_start) {
                        if (c_end >= n_end) {
                            overlaps.add(JSON.stringify([c_start, n_end]));
                        }
                        if (c_end <= n_end) {
                            overlaps.add(JSON.stringify([c_start, c_end]));
                        }
                    }
                }
            }

            overlaps.forEach(overlap => {
                let o = JSON.parse(overlap);
                let r = new StaticRange({
                    'startContainer': node,
                    'endContainer': node,
                    'startOffset': o[0],
                    'endOffset': o[1]
                });
                r.owner = container;
                CSS.highlights.get('overlap').add(r);
            });
        }
    }

    let match_count_editable = 0;
    let match_count_code = 0;

    let code = editable.innerHTML;
    if (code.endsWith('<br>')) {
        code = code.substring(0, code.length-3);
    }
    terms['normal'].forEach(re => {
        match_count_editable += highlightWithin(editable, re);
        match_count_code += matchCount(code, re);
    })
    terms['regex'].forEach(re => {
        match_count_editable += highlightWithin(editable, re);
        match_count_code += matchCount(code, re);
    })
    terms['noncomb'].forEach(re => {
        match_count_editable += highlightWithin(editable, re, true);
        match_count_code += matchCount(code.normalize("NFKD"), re);
    })
    highlightOverlaps();


    if (code_mirror) {
        ranges = new Map();
        terms['normal'].forEach(re => {
            highlightWithin(code_mirror.closest('.CodeMirror'), re);
        })
        terms['regex'].forEach(re => {
            highlightWithin(code_mirror.closest('.CodeMirror'), re);
        });
        terms['noncomb'].forEach(re => {
            highlightWithin(code_mirror.closest('.CodeMirror'), re, true);
        });
        highlightOverlaps();
    }

    // Let's not try to do unnecessary work
    if (match_count_code + match_count_editable == 0) {
        return
    }

    matched_fields++;
    matched_total += Math.max(match_count_editable, match_count_code);

    // There are matches not visible to the user but are inside code. Highlight code button to inform.
    if (match_count_code > match_count_editable) {
        highlightCodeExpander(container);
    }

    editable.addEventListener('focus', editableOnFocus); // TODO: remove stale listeners?
    editable.addEventListener('blur', editableOnBlur);

    if (code_mirror) {
        code_mirror.addEventListener('focus', codeOnFocus);
        code_mirror.addEventListener('blur', codeOnBlur);
    }
    // Try this again in case the match is inside code mirror
    if (scroll_to === null) {
        scroll_to = container;
    }

    if (minimap_now) {
        fillMinimap();
    }
}

function unhighlightField(container) {
    CSS.highlights.get('match').forEach(hl => {
        if (hl.owner == container) {
            CSS.highlights.get('match').delete(hl);
        }
    })
    CSS.highlights.get('overlap').forEach(hl => {
        if (hl.owner == container) {
            CSS.highlights.get('overlap').delete(hl);
        }
    })
}

function fillMinimap() {
    // If the field area is too small to generate a scroll bar, we cap the height of the minimap in the
    // positioning calculation to match it. This gives us precise notch positioning when there's no scrolling.
    let max_y = fieldarea.scrollHeight;
    if (fieldarea.scrollHeight < scrollarea.clientHeight) {
        max_y = scrollarea.clientHeight;
    }

    let fragment = new DocumentFragment();

    function addNotch(target) {
        // To get the correct position, we have to take into account how much the user has scrolled down
        // and how much the toolbar is pushing the content down. I do not understand why all this is required
        // instead of getting the correct position from getClientRects(). Nevertheless, through trial and error,
        // I found this combination of additions and subtractions resolves the precise coordinates of the
        // highlighted range.

        let notch = document.createElement('div');
        notch.setAttribute('class', 'match-position');
        let range = document.createRange();

        if (target instanceof StaticRange) {
          // Is a highlighter entry. We have exact range.
          range.setStart(target.startContainer, target.startOffset);
          range.setEnd(target.endContainer, target.endOffset);
        } else {
          // Is a code button. Can select whole thing.
          range.selectNodeContents(target);
        }

        let rect = range.getClientRects()[0];
        if (rect == null) {
            // The observer fires while note is changing. Ignore these.
            return
        }

        let tb = toolbar.clientHeight+1; // The +1 is for some kind of margin? Lines up better with it present.
        let fromtop = scrollarea.scrollTop + rect.top + (rect.height / 2);
        let pos = ((fromtop-tb) / max_y) * 100;
        // Cap min/max because they might be hard to see at the extremes
        pos = Math.min(99.6, Math.max(0.4, pos));
        notch.style.top = pos +"%";
        fragment.append(notch);
    }
    CSS.highlights.get('match').forEach(hl => addNotch(hl));
    document.querySelectorAll(".field-container[bsrh-moreincode=true").forEach(container => {
      addNotch(container.querySelector('.plain-text-badge button > span'));
    });

    minimap.innerHTML = '';
    minimap.append(fragment);
}

function editableOnFocus(event) {
  let editable = event.currentTarget;
  let container = editable.parentNode.host.closest('.field-container');
  unhighlightField(container);
}

function editableOnBlur(event) {
  let editable = event.currentTarget;
  let container = editable.parentNode.host.closest('.field-container');
  highlightField(container);
}

function codeOnFocus(event) {
  let code_mirror = event.currentTarget;
  let container = code_mirror.closest('.field-container');
  if (container.hasAttribute('bsrh-moreincode')) {
    // Seems to be a race condition? This makes it work
    setTimeout(() => {
      highlightField(container);
      fillMinimap();
    }, 0)
  } else {
    setTimeout(() => {
      // Highlight the field to fill out the minimap with the new matches before removing
      highlightField(container);
      unhighlightField(container);
    }, 0)
  }
}

function codeOnBlur(event) {
  let code_mirror = event.currentTarget;
  let container = code_mirror.closest('.field-container');
  highlightField(container);
}

function highlightCodeExpander(container) {
    container.setAttribute('bsrh-moreincode', true);
}

function unhighlightCodeExpander(container) {
    container.removeAttribute('bsrh-moreincode');
}

function highlightTags() {
    let buttons = document.querySelectorAll("button[data-addon-tag]");
    terms_parsed['tags'].forEach(tag => {
        let re = new RegExp(tag, "gi");
        buttons.forEach(element => {
            let tag_text = element.querySelector('span').childNodes[0];
            let matches = [...tag_text.data.matchAll(re)];
            matches.forEach((match) => {
                let r = new StaticRange({
                    'startContainer': tag_text,
                    'endContainer': tag_text,
                    'startOffset': match.index,
                    'endOffset': match.index + match[0].length
                });
                CSS.highlights.get('tag').add(r);
                matched_tags++;
                matched_total++;
            });
        });
    });
}

// UI controls
function onAuto(event) {
  auto_scroll = !auto_scroll;
  pycmd('BSRH:' + JSON.stringify({'auto': auto_scroll}));
  updateControls();
}

function scrollToMatch() {
    let target = scroll_to;
    // The positioning code resembles the minimap notch positioning, but tweaked
    // to center after the position is found and without the percentage.

    let max_y = fieldarea.scrollHeight;
    if (fieldarea.scrollHeight < scrollarea.clientHeight) {
        return;
    }

    let range = document.createRange();
    if (target instanceof StaticRange) {
      range.setStart(target.startContainer, target.startOffset);
      range.setEnd(target.endContainer, target.endOffset);
    } else {
      range.selectNodeContents(target);
    }
    let rect = range.getClientRects()[0];
    if (rect == null) {return}
    let tb = toolbar.clientHeight+1;
    let fromtop = scrollarea.scrollTop + rect.top + (rect.height / 2);
    let pos = fromtop-tb;
    let centered = pos - (scrollarea.clientHeight / 2);
    scrollarea.scrollTo(0, centered);
}
