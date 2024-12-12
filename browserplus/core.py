# -*- coding: utf-8 -*-
import json

from anki.hooks import wrap
from aqt import *
from aqt import gui_hooks
from aqt.browser import SearchContext
from aqt.editor import Editor, EditorMode
from aqt.webview import WebContent

addon_package = mw.addonManager.addonFromModule(__name__)

class BrowserPlus:
    def __init__(self, mw):
        self.mw = mw
        self.filter_terms = []
        self.last_search = ''

    def _load(self, browser):
        self.browser = browser
        self.table = browser.table
        self.editor = browser.editor
        self.col = browser.col
        # Text box changes
        self.browser.form.searchEdit.lineEdit().textEdited.connect(self.onTextEdited)
        # Drop-down selection
        self.browser.form.searchEdit.currentIndexChanged.connect(self.onCurrentIndexChanged)


    def willSearch(self, ctx: SearchContext):
        pass

    def didSearch(self, ctx: SearchContext):
        """Search has happened (regardless of source). Do highlighting."""
        terms = get_search_terms(ctx.search)
        self.filter_terms = extract_searchable_terms(terms)
        print("BP: didSearch: Highlighting these terms: ", self.filter_terms)

    def _column_data(self, item, is_notes_mode, row, active_columns):
        c = self.table._state.get_card(item)
        n = self.table._state.get_note(item)
        for index, key in enumerate(active_columns):
            #row.cells[index].text = "test text goes here"
            pass

    def onTextEdited(self):
        """Textbox text has changed. Do a search."""
        text = self.browser.current_search()
        if text != self.last_search:
            try:
                normed = self.col.build_search_string(text)
                self.last_search = normed
                self.table.search(normed)
            except Exception as err:
                print("Not a valid search. Show indicator somewhere.")
    def onCurrentIndexChanged(self, index):
        """Do a search on drop-down selection. -1 is text edit. Skip those as we handle already"""
        if index >= 0:
            self.onTextEdited()



class FilterHighlightDelegate(QStyledItemDelegate):
    def __init__(self, owner, choices):
        super().__init__(owner)
        self.items = choices
        self.selection = QTextCharFormat()
        self.selection.setBackground(QColor("#6c6435"))

    # def sizeHint(self, option, index):
    #     self.initStyleOption(option, index)
    #     doc = QTextDocument()
    #     doc.setHtml(option.text)
    #     doc.setTextWidth(option.rect.width())
    #     return QSize(doc.idealWidth(), doc.size().height())

    def paint(self, painter, option, index):
        if index.column() >= 0:  # todo: blacklist columns
            self.initStyleOption(option, index)

            # where = [(m.start(), m.end()) for m in re.finditer('the', txt)]
            # style = option.widget.style()
            # doc.setPlainText(option.text)
            # doc.setDefaultFont(option.font)
            # doc.setTextWidth(option.rect.width())
            # doc.adjustSize()

            doc = QTextDocument(index.model().data(index))
            doc.setPageSize(QSizeF(option.rect.width(), option.rect.height()))

            textOption = QTextOption()
            textOption.setTextDirection(option.direction)
            textOption.setAlignment(option.displayAlignment)
            doc.setDefaultTextOption(textOption)

            position = 0
            while position >= 0:
                cur = doc.find('the', position)
                cur.setCharFormat(self.selection)
                position = cur.position()
            painter.save()
            painter.translate(option.rect.x(), option.rect.y())
            doc.drawContents(painter)
            painter.restore()
        else:
            return QStyledItemDelegate.paint(self, painter, option, index)


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

def _setup_view(self):
    self._view.setItemDelegate(FilterHighlightDelegate(self.browser, self._model))


def on_webview_will_set_content(web_content: WebContent, context):
    if not isinstance(context, Editor):
        return
    web_content.js.append(f"/_addons/{addon_package}/web/editor.js")

def myLoadNote(editor, focusTo=None) -> None:
    if editor.editorMode is EditorMode.BROWSER:
        # TODO: is there a better way to escape everything?
        terms = json.dumps(browser_plus.filter_terms)
        terms = terms.replace("'", r"\'")
        terms = terms.replace("\\\\", r"\\\\")
        terms = terms.replace("|", r"\\\\|")
        param = f"bpNoteLoad('{terms}');"
        print(param)
        editor.web.eval(param)


mw.addonManager.setWebExports(__name__, r"web/.*")
browser_plus = BrowserPlus(mw)

# Hooks
gui_hooks.browser_will_show.append(browser_plus._load)
gui_hooks.browser_will_search.append(browser_plus.willSearch)
gui_hooks.browser_did_search.append(browser_plus.didSearch)
gui_hooks.browser_did_fetch_row.append(browser_plus._column_data)
gui_hooks.webview_will_set_content.append(on_webview_will_set_content)
aqt.browser.Table._setup_view = wrap(aqt.browser.Table._setup_view, _setup_view)
Editor.loadNote = wrap(Editor.loadNote, myLoadNote, "after")

