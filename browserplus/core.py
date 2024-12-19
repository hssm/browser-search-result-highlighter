# -*- coding: utf-8 -*-
import json

from anki.hooks import wrap
from aqt import *
from aqt import gui_hooks
from aqt.browser import SearchContext
from aqt.editor import Editor, EditorMode
from aqt.webview import WebContent
from aqt.theme import theme_manager

from browserplus.utils.parser import parse_search

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
        self.browser.form.searchEdit.lineEdit().textEdited.connect(self.on_text_edited)
        # Drop-down selection
        self.browser.form.searchEdit.currentIndexChanged.connect(self.on_current_index_changed)


    def did_search(self, ctx: SearchContext):
        """Search has happened (regardless of source). Do highlighting."""
        self.filter_terms = parse_search(ctx.search)
        print("BP: didSearch: Highlighting these terms: ", self.filter_terms)

    def _column_data(self, item, is_notes_mode, row, active_columns):
        c = self.table._state.get_card(item)
        n = self.table._state.get_note(item)
        for index, key in enumerate(active_columns):
            #row.cells[index].text = "test text goes here"
            pass

    def on_text_edited(self):
        """Textbox text has changed. Do a search."""
        text = self.browser.current_search()
        if text != self.last_search:
            try:
                normed = self.col.build_search_string(text)
                self.last_search = normed
                self.table.search(normed)
                self.browser.form.searchEdit.setStyleSheet("")
            except Exception as err:
                if theme_manager.night_mode:
                    self.browser.form.searchEdit.setStyleSheet("QWidget{background: #4a3a36}")
                else:
                    self.browser.form.searchEdit.setStyleSheet("QWidget{background: #ffc9b9}")
                # Fake a search to remove previous highlights as current search is not valid
                self.filter_terms = []
                self.did_load_note(self.editor)

    def on_current_index_changed(self, index):
        """Do a search on drop-down selection. -1 is text edit. Skip those as we handle already"""
        if index >= 0:
            self.on_text_edited()

    def on_webview_will_set_content(self, web_content: WebContent, context):
        if not isinstance(context, Editor):
            return
        web_content.js.append(f"/_addons/{addon_package}/web/editor.js")

    def did_load_note(self, editor, focusTo=None) -> None:
        if editor.editorMode is EditorMode.BROWSER:
            # TODO: is there a better way to escape everything?
            terms = json.dumps(browser_plus.filter_terms)
            terms = terms.replace("'", r"\'")
            terms = terms.replace("\\\\", r"\\\\")
            terms = terms.replace("|", r"\\\\|")
            editor.web.eval(f"terms_str = '{terms}'")
            editor.web.eval(f"parseTerms()")
            editor.web.eval("beginHighlighter()")

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


def _setup_view(self):
    self._view.setItemDelegate(FilterHighlightDelegate(self.browser, self._model))

mw.addonManager.setWebExports(__name__, r"web/.*")
browser_plus = BrowserPlus(mw)

# Hooks
gui_hooks.browser_will_show.append(browser_plus._load)
gui_hooks.browser_did_search.append(browser_plus.did_search)
gui_hooks.browser_did_fetch_row.append(browser_plus._column_data)
gui_hooks.webview_will_set_content.append(browser_plus.on_webview_will_set_content)
gui_hooks.editor_did_load_note.append(browser_plus.did_load_note)

aqt.browser.Table._setup_view = wrap(aqt.browser.Table._setup_view, _setup_view)
