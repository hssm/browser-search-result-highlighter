# https://github.com/hssm/quick-search-and-highlight
# Version 1.3

import json

from aqt import *
from aqt import gui_hooks
from aqt.browser import SearchContext
from aqt.editor import Editor, EditorMode
from aqt.theme import theme_manager
from aqt.webview import WebContent

from .utils.parser import parse_search

addon_package = mw.addonManager.addon_from_module(__name__)

class QuickSearchAndHighlight:
    def __init__(self, mw):
        self.mw = mw
        self.filter_terms = []
        self.last_search = ''

    def editor_init(self, editor):
        config = mw.col.get_config('qsah', {'auto': True})
        auto = json.dumps(config['auto'])
        editor.web.eval(f"addControls({auto})")

    def browser_will_show(self, browser):
        self.browser = browser
        self.table = browser.table
        self.editor = browser.editor
        self.col = browser.col
        # Text box changes
        self.browser.form.searchEdit.lineEdit().textEdited.connect(self.on_text_edited)
        # Drop-down selection
        self.browser.form.searchEdit.currentIndexChanged.connect(self.on_current_index_changed)

    def did_search(self, ctx: SearchContext):
        """Search has happened (regardless of source). Do highlight."""
        self.filter_terms = parse_search(ctx.search)
        print("qsah: Highlighting these terms: ", self.filter_terms)

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
                # This is breaking the browser UI ???
                # if theme_manager.night_mode:
                #     self.browser.form.searchEdit.setStyleSheet("QComboBox {background-color: #4a3a36;}")
                # else:
                #     self.browser.form.searchEdit.setStyleSheet("QComboBox {background-color: #ffc9b9;}")
                # Fake a search to remove previous highlights as current search is not valid
                self.filter_terms = []
                self.editor_did_load_note(self.editor)

    def on_current_index_changed(self, index):
        """Do a search on drop-down selection. -1 is text edit. Skip those as we handle already"""
        if index >= 0:
            self.on_text_edited()

    def on_webview_will_set_content(self, web_content: WebContent, context):
        if not isinstance(context, Editor):
            return
        web_content.js.append(f"/_addons/{addon_package}/web/editor.js")
        web_content.css.append(f"/_addons/{addon_package}/web/editor.css")

    def editor_did_load_note(self, editor, focusTo=None) -> None:
        if editor.editorMode is EditorMode.BROWSER:
            # TODO: is there a better way to escape everything?
            terms = json.dumps(qsah.filter_terms)
            terms = terms.replace("'", r"\'")
            terms = terms.replace("\\\\", r"\\\\")
            terms = terms.replace("|", r"\\\\|")
            editor.web.eval(f"terms_str = '{terms}'")
            editor.web.eval(f"parseTerms()")
            editor.web.eval("beginHighlighter()")


    def on_js_message(self, handled, message, context):
        if not message.startswith('QSAH:'):
            return handled

        vals = json.loads(message[5:])
        config = mw.col.get_config('qsah', dict())
        config['auto'] = vals['auto']
        mw.col.set_config('qsah', config)
        return True, None

mw.addonManager.setWebExports(__name__, r"web/.*")
qsah = QuickSearchAndHighlight(mw)

# Hooks
gui_hooks.browser_will_show.append(qsah.browser_will_show)
gui_hooks.browser_did_search.append(qsah.did_search)
gui_hooks.webview_will_set_content.append(qsah.on_webview_will_set_content)
gui_hooks.editor_did_load_note.append(qsah.editor_did_load_note)
gui_hooks.editor_did_init.append(qsah.editor_init)
gui_hooks.webview_did_receive_js_message.append(qsah.on_js_message)
