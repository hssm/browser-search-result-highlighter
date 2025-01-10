// String from python
let terms_str = null;

// Parsed in javascript
let terms = null;

// Regex to search/replace
let re = null;

// First match found to scroll to
let scroll_to = null;

// Scroll to first match: user toggleable
let auto_scroll = false;

// Number of matches total
let matched_total = 0;

// Number of fields with matches
let matched_fields = 0;

// Observer to detect code button/shortcut
const watch = (mutations, observer) => {
    for (let i = 0; i < mutations.length; i++) {
      let mutation = mutations[i];
      if (mutation.addedNodes.length > 0) {
        try {
          let node = mutation.addedNodes[0];
          if (node.classList.contains('CodeMirror-line')) {
            let container = node
                              .closest('.editing-area')
                              .querySelector('.rich-text-editable').shadowRoot;
            let code_mirror = container.host
                              .closest('.editing-area')
                              .querySelector('.CodeMirror textarea');
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

function addControls(auto) {
    // First load has a race condition. Keep trying until toolbar appears.
    let toolbar = document.querySelector('div[role="toolbar"]');
    if (!toolbar) {
        setTimeout(() => {addControls(auto)}, 20)
        return;
    }
    toolbar.insertAdjacentHTML("beforeend", controls);
    let checkbox = toolbar.querySelector('#bsrh-auto');
    checkbox.addEventListener('change', on_auto);
    auto_scroll = auto;
    checkbox.checked = auto;
}

function updateControls() {
    document.getElementById('bsrh-mtotal').innerHTML = matched_total;
    document.getElementById('bsrh-mfields').innerHTML = matched_fields;
}

// Build a regex from the string given to us by python
function parseTerms() {
  terms = JSON.parse(terms_str);
  re = new RegExp('('+terms.join("|")+')', "gi");
}

// Do initial work after note loads.
function beginHighlighter() {
    // Clean slate when switching notes
    CSS.highlights.clear();
    CSS.highlights.set('match', new Highlight());
    scroll_to = null;
    matched_fields = 0;
    matched_total = 0;

    // No work to do if no search terms
    if (terms.length == 0) {
      return;
    }

    // Highlight all fields
    let fields = document.querySelectorAll('.field-container .rich-text-editable');
    fields.forEach((f) => {
      highlightField(f.shadowRoot);
    })

    // Attach observers for the HTML editor mode (detect when it appears).
    // There's both a button and a keyboard shortcut. The editor is auto-focused
    // when it appears before we've set up our event listeners so they'll miss
    // it and our focus detection becomes wrong. This corrects it.
    // Clear out the old ones first.
    observers.forEach((o) => {
        o.disconnect();
    })
    observers = [];
    let outer_containers = document.querySelectorAll('.field-container');
    outer_containers.forEach((c) => {
      let observer = new MutationObserver(watch);
      observers.push(observer);
      observer.observe(c, {childList: true, subtree: true});
    })

    // Set UI
    updateControls();

    if (auto_scroll && scroll_to) {
        scroll_to.scrollIntoViewIfNeeded();
    }
}

// Highlight a single field
function highlightField(container) {
    if (terms.length == 0) {
      return;
    }

    let editable = container.querySelector('anki-editable');
    let code_mirror = container.host
                        .closest('.editing-area')
                        .querySelector('.CodeMirror textarea');

    let matched = 0;
    function highlightInChildren(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            let matches = [...node.data.matchAll(re)];
            matches.forEach((match) => {
                matched++;
                let r = new StaticRange({
                    'startContainer': node,
                    'endContainer': node,
                    'startOffset': match.index,
                    'endOffset': match.index + match[0].length
                });
                r.owner = container;
                CSS.highlights.get('match').add(r);
            });
        } else {
            node.childNodes.forEach(n => highlightInChildren(n))
        }
    }
    highlightInChildren(editable);
    if (code_mirror) {
        highlightInChildren(code_mirror.closest('.CodeMirror'));
    }

    if (!matched) {
        return
    }

    matched_total += matched;
    matched_fields++;

    editable.addEventListener('focus', editableOnFocus);
    editable.addEventListener('blur', editableOnBlur);


    if (code_mirror) {
      code_mirror.addEventListener('focus', codeOnFocus);
      code_mirror.addEventListener('blur', codeOnBlur);
    }
    if (!scroll_to) {
        scroll_to = container.host.closest('.field-container');
    }
}

function unhighlightField(container) {
    CSS.highlights.get('match').forEach(sr => {
        if (sr.owner == container) {
            CSS.highlights.get('match').delete(sr);
        }
    })
}

function editableOnFocus(event) {
  let editable = event.currentTarget;
  let container = editable.parentNode;
  unhighlightField(container);
}

function editableOnBlur(event) {
  let editable = event.currentTarget;
  let container = editable.parentNode;
  highlightField(container);
}

function codeOnFocus(event) {
  let code_mirror = event.currentTarget;
  let container = code_mirror
                    .closest('.editing-area')
                    .querySelector('.rich-text-editable').shadowRoot;
  unhighlightField(container);
}

function codeOnBlur(event) {
  let code_mirror = event.currentTarget;
  let container = code_mirror
                    .closest('.editing-area')
                    .querySelector('.rich-text-editable').shadowRoot;
  let editable = container.querySelector('anki-editable');
  highlightField(container);
}

// UI controls
function on_auto(event) {
  auto_scroll = event.target.checked;
  pycmd('BSRH:' + JSON.stringify({'auto': auto_scroll}));
}