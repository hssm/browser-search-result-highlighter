// String from python
let terms_str = null;

// Parsed in javascript
let terms = null;

// Regex to search/replace
let re = null;

// Currently focused element. Avoid exit events while still in it.
let has_focus = null;
let has_focus_code = null;

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
            removeOverlay(container);
            has_focus = null;
            has_focus_code = code_mirror;
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
<span id="qsah-controls">
    <input type="checkbox" id="qsah-auto" name="qsah-auto"/>
    <label for="qsah-auto">Auto Scroll</label>
    <span id="qsah-separator">|</span>
    <span id="qsah-mtotal">0</span> matches in
    <span id="qsah-mfields">0</span> fields
</span>
`

// Count occurrences in regex
const matchCount = (str, re) => {
  return str?.match(re)?.length ?? 0;
};


function addControls(auto) {
    // First load has a race condition. Keep trying until toolbar appears.
    let toolbar = document.querySelector('div[role="toolbar"]');
    if (!toolbar) {
        setTimeout(() => {addControls(auto)}, 20)
        return;
    }
    toolbar.insertAdjacentHTML("beforeend", controls);
    let checkbox = toolbar.querySelector('#qsah-auto');
    checkbox.addEventListener('change', on_auto);
    auto_scroll = auto;
    checkbox.checked = auto;
}

function updateControls() {
    document.getElementById('qsah-mtotal').innerHTML = matched_total;
    document.getElementById('qsah-mfields').innerHTML = matched_fields;
}

// Build a regex from the string given to us by python
function parseTerms() {
  terms = JSON.parse(terms_str);
  re = new RegExp('('+terms.join("|")+')', "gi");
}

// Do initial work after note loads.
function beginHighlighter() {
    // Clean slate when switching notes
    removeAllOverlays();
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
      let container = f.shadowRoot;
      highlightField(f, container);
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

    updateControls();

    if (auto_scroll && scroll_to) {
        scroll_to.scrollIntoViewIfNeeded();
    }
}

// Highlight a single field
function highlightField(field, container) {
    if (terms.length == 0) {
      return;
    }
    let orig = container.querySelector('anki-editable');

    // Only do work if we have a match
    let count = matchCount(orig.innerHTML, re);
    if (!count) {
      return;
    }
    matched_total += count;
    matched_fields++;

    let overlay = orig.cloneNode(true);
    orig.style.display = 'none';
    overlay.innerHTML = overlay.innerHTML.replace(re,
      "<span style='background-color: #fbfb82; color: black;'>$&</span>");
    overlay.setAttribute('clone', true);
    container.append(overlay);
    overlay.addEventListener('focus', cloneOnFocus);
    overlay.addEventListener('mouseover', cloneMouseover);
    orig.addEventListener('focus', origOnFocus);
    orig.addEventListener('mouseleave', origOnMouseleave);
    orig.addEventListener('blur', origOnBlur);

    let code_mirror = container.host
                        .closest('.editing-area')
                        .querySelector('.CodeMirror textarea');
    if (code_mirror) {
      code_mirror.addEventListener('focus', codeOnFocus);
      code_mirror.addEventListener('blur', codeOnBlur);
    }
    if (!scroll_to) {
        scroll_to = container.host.closest('.field-container');
    }
}

// When loading a note, remove overlay from all fields. Field
// containers are reused so we can't rely on them being new and
// empty on card change.
function removeAllOverlays() {
    let fields = document.querySelectorAll('.field-container .rich-text-editable');
    fields.forEach((f) => {
        let container = f.shadowRoot;
        removeOverlay(container);
        removeHiddenShadow(container);
    });
}

// Remove overlay from a single field
function removeOverlay(container) {
    let clone = container.querySelector('anki-editable[clone]');
    if (clone) {
        let orig = clone.previousElementSibling;
        orig.style.display = 'block';
        clone.remove();
    }
}


/*
We still need to let the user click into a field and edit the original (not
the overlay). These events let us hide the overlay when the user hovers over
or focuses on a field and rebuild the overlay when they leave it.

It does change the focus interactions compared to the original but it's a
tradeoff that has to be made to gain this feature.

Focus events and positioning in a contenteditable inside a shadow dom is 100%
broken and cannot be used for any clever tricks to mask focus switching
seamlessly. This is the clever trick. It masks it well enough.
*/

function cloneMouseover(event) {
  let clone = event.currentTarget;
  let orig = clone.previousElementSibling;
  let container = orig.parentNode;
  removeOverlay(container);
  // Add yellow glow to show it's hidden
  addHiddenShadow(container);
}

// When tabbing in
function cloneOnFocus(event) {
  let clone = event.currentTarget;
  let orig = clone.previousElementSibling;
  let container = orig.parentNode;
  removeOverlay(container);
  orig.focus();
  has_focus = orig;
}

function origOnFocus(event) {
  let orig = event.currentTarget;
  let container = orig.parentNode;
  has_focus = orig;
  removeHiddenShadow(container);

}

function origOnMouseleave(event) {
  let orig = event.currentTarget;
  if (has_focus == orig) {
    return;
  }
  let container = orig.parentNode;
  let code_mirror = container.host
                    .closest('.editing-area')
                    .querySelector('.CodeMirror textarea');
  if (has_focus_code && has_focus_code == code_mirror) {
    return;
  }
  let clone = container.querySelector('anki-editable[clone]');
  if (clone) {
    return;
  }
  highlightField(orig, container);
  has_focus = null;
  removeHiddenShadow(container);
}

function origOnBlur(event) {
  let orig = event.currentTarget;
  let container = orig.parentNode;
  let clone = container.querySelector('anki-editable[clone]');
  if (clone) {
    return;
  }
  highlightField(orig, container);
  has_focus = null;
  removeHiddenShadow(container);
}

function codeOnFocus(event) {
  let code_mirror = event.currentTarget;
  let container = code_mirror
                    .closest('.editing-area')
                    .querySelector('.rich-text-editable').shadowRoot;
  removeOverlay(container);
  has_focus_code = code_mirror;
}

function codeOnBlur(event) {
  let code_mirror = event.currentTarget;
  let container = code_mirror
                    .closest('.editing-area')
                    .querySelector('.rich-text-editable').shadowRoot;
  let orig = container.querySelector('anki-editable');
  highlightField(orig, container);
  has_focus_code = null;
}

function addHiddenShadow(container) {

  container.host.closest('.editor-field').style.outline = '2px solid #e6e678';
  if (document.documentElement.getAttribute('data-bs-theme') == 'dark') {
    container.host.closest('.editor-field').style.outline = '2px solid #6f6b44';
  }
}
function removeHiddenShadow(container) {
  container.host.closest('.editor-field').style.outline = '';
}


// UI controls

function on_auto(event) {
  auto_scroll = event.target.checked;
  pycmd('QSAH:' + JSON.stringify({'auto': auto_scroll}));
}