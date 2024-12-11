function bpNoteLoad(terms) {
    bpClearStale();

    terms = JSON.parse(terms);
    if (terms.length == 0) {
      return;
    }

    console.log("Note loaded with highlight terms: " + terms);
    let re = new RegExp('('+terms.join("|")+')', "gi");
    let fields = document.querySelectorAll('.field-container .rich-text-editable');
    fields.forEach((f) => {
        let container = f.shadowRoot;
        let orig = container.querySelector('anki-editable');
        orig.style.display = 'block';
        let overlay = orig.cloneNode(true);
        orig.style.display = 'none';
        overlay.innerHTML = overlay.innerHTML.replace(re, "<span style='background-color: #6c6435'>$&</span>");
        overlay.setAttribute('clone', true);
        container.append(overlay);
        overlay.addEventListener('focus', bpOnFocus);
        overlay.addEventListener('mouseover', bpOnHover);
    })
}


// Safer to do on its own at the start so an error doesn't leave old
// overlays on top of different cards.
function bpClearStale() {
    let fields = document.querySelectorAll('.field-container .rich-text-editable');
    fields.forEach((f) => {
        let container = f.shadowRoot;
        let stale = container.querySelector('anki-editable[clone]');
        if (stale) {
            stale.remove();
        }
    });
}

function bpOnHover(event) {
  let clone = event.target;
  let orig = clone.previousElementSibling;
  orig.style.display = 'block';
  clone.remove();
}

function bpOnFocus(event) {
  let clone = event.target;
  let orig = clone.previousElementSibling;
  orig.style.display = 'block';
  clone.remove();
  orig.focus();
}
