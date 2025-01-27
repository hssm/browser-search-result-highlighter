// String from python
let terms_str = null;

// Parsed in javascript
let terms = null;

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

// UI controls
let controls =
`
<span id="bsrh-controls">
    <input type="checkbox" id="bsrh-auto" name="bsrh-auto"/>
    <label for="bsrh-auto">Auto Scroll</label>
    <span id="bsrh-separator">|</span>
    <span id="bsrh-mtotal">0</span> matches in
    <span id="bsrh-mfields">0</span> fields
</span>
`

let minimap = `<div id="match-minimap"></div>`;

function addControls(auto) {
    // First load has a race condition. Keep trying until toolbar appears.
    let toolbar = document.querySelector('div[role="toolbar"]');
    if (!toolbar) {
        setTimeout(() => {addControls(auto)}, 20)
        return;
    }
    toolbar.insertAdjacentHTML("beforeend", controls);
    let checkbox = toolbar.querySelector('#bsrh-auto');
    checkbox.addEventListener('change', onAuto);
    auto_scroll = auto;
    checkbox.checked = auto;

    let scrollarea = document.querySelector('.scroll-area-relative');
    scrollarea.insertAdjacentHTML("beforeend", minimap);
}

function updateControls() {
    document.getElementById('bsrh-mtotal').innerHTML = matched_total;
    document.getElementById('bsrh-mfields').innerHTML = matched_fields;
}

// Build regexes from the string given to us by python
function parseTerms() {
  terms = JSON.parse(atob(terms_str));
}

// Do initial work after note loads.
function beginHighlighter() {
    // Clean slate when switching notes
    CSS.highlights.clear();
    CSS.highlights.set('match', new Highlight());
    scroll_to = null;
    matched_fields = 0;
    matched_total = 0;
    let minimap = document.querySelector('#match-minimap');
    let scrollarea = document.querySelector('.scroll-area-relative .flex-column');
    let containers = document.querySelectorAll('.field-container');
    if (containers.length == 0) {
      return;
    }
    containers.forEach((c) => { unhighlightCodeExpander(c); })
    minimap.innerHTML = '';

    // No work to do if no search terms
    if (terms.length == 0) {
      updateControls();
      return;
    }

    // Highlight all fields
    containers.forEach((c) => { highlightField(c); })

    // Attach observers for the HTML editor (detect when it appears).
    // Clear out the old ones first.
    observers.forEach((o) => { o.disconnect(); })
    observers = [];
    containers.forEach((c) => {
      let observer = new MutationObserver(watch);
      observers.push(observer);
      observer.observe(c, {childList: true, subtree: true});
    })

    // Set UI
    updateControls();

    if (auto_scroll && scroll_to) {
        // There's odd behaviour on the first load of a note type and when there's
        // an image loading. Scrolling on the next loop gets the correct position.
        setTimeout(() => { scroll_to.scrollIntoViewIfNeeded(); }, 0)
    }
}

// Highlight a single field
function highlightField(container) {
    // Combine the regexes for field match and all match
    current_res = []
    if (terms[''].length && terms[''] != '.*') {
        current_res.push(terms['']);
    }
    field_name = container.querySelector('.label-name').textContent.toLowerCase();
    Object.keys(terms).forEach(k => {
        k = k.toLowerCase();
        if (k.endsWith('*')) {
            let start = k.substr(0, k.length-1);
            if (field_name.startsWith(start)) {
                if (terms[k] != '.*') {
                    current_res.push(terms[k])
                }
            }
        } else if (k == field_name) {
            if (terms[k].length && terms[k] != '.*') {
                current_res.push(terms[k])
            }
        }
    })
    re = current_res.join('|');

    // Didn't search for anything
    if (re.length == 0) {
      return;
    }

    re = new RegExp(re, "gi");

    let field_root = container.querySelector('.rich-text-editable').shadowRoot;
    let editable = field_root.querySelector('anki-editable');
    let code_mirror = container.querySelector('.CodeMirror textarea');
    if (code_mirror && code_mirror.closest('.plain-text-input').hasAttribute('hidden')) {
        code_mirror = null;
    }

    // Note on counting matches: We count the matches on the text nodes in the field instead of the whole field's
    // editable.textContent because it gives us the same match behaviour as Anki's search. E.g., the field
    // gr<i>ee</i>tings does not match 'greetings', so we won't either, even if a user may expect it to.

    let minimap = document.getElementById("match-minimap");
    let scrollarea = document.querySelector('.scroll-area-relative .flex-column');

    let highlightCount = 0;
    function highlightInChildren(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            let matches = [...node.data.matchAll(re)];
            matches.forEach((match) => {
                highlightCount++;
                let r = new StaticRange({
                    'startContainer': node,
                    'endContainer': node,
                    'startOffset': match.index,
                    'endOffset': match.index + match[0].length
                });
                r.owner = container;
                CSS.highlights.get('match').add(r);
                if (!scroll_to) {
                    scroll_to = node.parentNode;
                }
                // Add minimap notch at element height within container
                let notch = document.createElement('div');
                notch.setAttribute('class', 'match-position');

                let range = document.createRange();
                range.selectNodeContents(node);
                let rect = range.getClientRects()[0];
                let mid = rect.height / 2;
                let pos = ((rect.top+mid) / scrollarea.scrollHeight) * 100;
                // Cap min/max because they might be hard to see at the extremes
                pos = Math.min(99.6, Math.max(0.4, pos));
                notch.style.top = pos +"%";
                minimap.append(notch);
            });
        } else {
            node.childNodes.forEach(n => highlightInChildren(n))
        }
    }
    highlightInChildren(editable);
    let match_count_editable = highlightCount;
    let match_count_code = matchCount(editable.innerHTML, re);

    if (code_mirror) {
        highlightInChildren(code_mirror.closest('.CodeMirror'));
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
    if (!scroll_to) {
        scroll_to = container;
    }
}

function unhighlightField(container) {
    CSS.highlights.get('match').forEach(hl => {
        if (hl.owner == container) {
            CSS.highlights.get('match').delete(hl);
        }
    })
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
    setTimeout(() => { highlightField(container) }, 0)
  } else {
    unhighlightField(container);
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

// UI controls
function onAuto(event) {
  auto_scroll = event.target.checked;
  pycmd('BSRH:' + JSON.stringify({'auto': auto_scroll}));
}