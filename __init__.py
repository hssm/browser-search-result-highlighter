# https://github.com/hssm/browser-search-result-highlighter
# Version 2.1

import json

from aqt import *
from aqt import gui_hooks
from aqt.browser import SearchContext
from aqt.editor import Editor, EditorMode
from aqt.webview import WebContent
import base64

from .utils.parser import parse_search

addon_package = mw.addonManager.addon_from_module(__name__)

class BrowserSearchResultHighlighter:
    def __init__(self, mw):
        self.mw = mw
        self.filter_terms = []

    def editor_init(self, editor):
        config = mw.col.get_config('bsrh', {'auto': True})
        auto = json.dumps(config['auto'])
        editor.web.eval(f"addControls({auto})")

    def browser_will_show(self, browser):
        self.browser = browser
        self.table = browser.table
        self.editor = browser.editor
        self.col = browser.col

    def did_search(self, ctx: SearchContext):
        """Search has happened (regardless of source). Do highlight."""
        self.filter_terms = parse_search(ctx.search)
        print("bsrh: Highlighting these terms: ", self.filter_terms)


    def on_webview_will_set_content(self, web_content: WebContent, context):
        if not isinstance(context, Editor):
            return
        web_content.js.append(f"/_addons/{addon_package}/web/editor.js")
        web_content.css.append(f"/_addons/{addon_package}/web/editor.css")

    def editor_did_load_note(self, editor, focusTo=None) -> None:
        if editor.editorMode is EditorMode.BROWSER:
            as_str = json.dumps(bsrh.filter_terms)
            as_b64 = base64.b64encode((as_str.encode())).decode()
            editor.web.eval(f"terms_str = '{as_b64}'")
            editor.web.eval(f"parseTerms()")
            editor.web.eval("beginHighlighter()")

    def on_js_message(self, handled, message, context):
        if not message.startswith('BSRH:'):
            return handled

        vals = json.loads(message[5:])
        config = mw.col.get_config('bsrh', dict())
        config['auto'] = vals['auto']
        mw.col.set_config('bsrh', config)
        return True, None

mw.addonManager.setWebExports(__name__, r"web/.*")
bsrh = BrowserSearchResultHighlighter(mw)

# Hooks
gui_hooks.browser_will_show.append(bsrh.browser_will_show)
gui_hooks.browser_did_search.append(bsrh.did_search)
gui_hooks.webview_will_set_content.append(bsrh.on_webview_will_set_content)
gui_hooks.editor_did_load_note.append(bsrh.editor_did_load_note)
gui_hooks.editor_did_init.append(bsrh.editor_init)
gui_hooks.webview_did_receive_js_message.append(bsrh.on_js_message)
