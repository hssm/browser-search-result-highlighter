This Anki add-on changes the browser to search as you type and to highlight your matches in the note editor so you can quickly see what you searched for in your notes.

The add-on DOES NOT modify your note content in any way. The highlighted field is an overlay on top of the real field, so anomalies in special cases (where HTML is used inside the field) are purely cosmetic.

TODO:
- Better styling. Highlight colors, invalid search background, night-mode colors.
- Scroll to first highlighted term
- Highlight inside table view? This is really, really hard.
- Visual indiator (border/shadow) when overlay is hidden so you know you're hiding a match

Known issues:
- Highlighting can create invalid HTML which may make the overlay display strangely. A match inside an image `src` will break image loading in the overlay, for example. Not really fixable but we may be able to code in exceptions for some cases.
