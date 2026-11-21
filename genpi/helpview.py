"""A small help window for genpi-gui.py.

Shows the Markdown files in help/ with a topic list on the left. Only the
Markdown that the help files use is understood:

    # / ## / ### headings      - bullets          1. numbered items
    ``` fenced blocks ```      > callouts         **bold** *italic* `code`
    [text](https://...) links, opened in the web browser

Paragraph lines are joined and wrapped to the window width.
"""

import re
import tkinter as tk
import webbrowser
from pathlib import Path
from tkinter import ttk

HELP_DIR = Path(__file__).resolve().parent / "help"

INLINE = re.compile(r"(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\(https?://[^)\s]+\))")
LINK = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")
NUMBERED = re.compile(r"^(\d+)\.\s+(.*)")

COLORS = {
    "bg": "#ffffff",
    "text": "#1f2430",
    "muted": "#5f6775",
    "heading": "#111827",
    "accent": "#2563eb",
    "block_bg": "#f3f4f6",
    "callout_bg": "#eef4ff",
    "code_bg": "#f1f3f5",
    "list_sel": "#dbe7ff",
}
SANS = "DejaVu Sans"
MONO = "DejaVu Sans Mono"


def render(text_widget: tk.Text, markdown: str) -> None:
    """Replace the widget's contents with the rendered Markdown."""
    t = text_widget
    t.configure(state="normal")
    t.delete("1.0", "end")
    lines = markdown.splitlines()
    i = 0
    first = True

    links = 0

    def inline(s: str, base: tuple[str, ...]) -> None:
        nonlocal links
        for part in INLINE.split(s):
            if not part:
                continue
            link = LINK.fullmatch(part)
            if link:
                links += 1
                tag = f"link{links}"
                t.insert("end", link[1], base + ("link", tag))
                t.tag_bind(tag, "<Button-1>", lambda e, url=link[2]: webbrowser.open(url))
            elif part.startswith("**") and part.endswith("**") and len(part) > 4:
                t.insert("end", part[2:-2], base + ("bold",))
            elif part.startswith("`") and part.endswith("`") and len(part) > 2:
                t.insert("end", part[1:-1], base + ("code",))
            elif part.startswith("*") and part.endswith("*") and len(part) > 2:
                t.insert("end", part[1:-1], base + ("italic",))
            else:
                t.insert("end", part, base)

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            i += 1
            continue

        if stripped.startswith("```"):
            i += 1
            block = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                block.append(lines[i])
                i += 1
            i += 1  # closing fence
            for n, bline in enumerate(block):
                tags = ("block",)
                if n == 0:
                    tags += ("blockfirst",)
                if n == len(block) - 1:
                    tags += ("blocklast",)
                t.insert("end", bline + "\n", tags)
        elif stripped.startswith("#"):
            level = len(stripped) - len(stripped.lstrip("#"))
            tag = {1: "h1", 2: "h2"}.get(level, "h3")
            if first and tag == "h1":
                tag = "h1first"
            inline(stripped[level:].strip() + "\n", (tag,))
            i += 1
        elif stripped.startswith("> "):
            parts = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                parts.append(lines[i].strip()[1:].strip())
                i += 1
            inline(" ".join(parts) + "\n", ("callout",))
        elif stripped.startswith("- ") or NUMBERED.match(stripped):
            m = NUMBERED.match(stripped)
            marker = f"{m.group(1)}." if m else "•"
            parts = [m.group(2) if m else stripped[2:]]
            i += 1
            while (i < len(lines) and lines[i].startswith("  ") and lines[i].strip()
                   and not lines[i].strip().startswith("- ")
                   and not NUMBERED.match(lines[i].strip())):
                parts.append(lines[i].strip())
                i += 1
            t.insert("end", f"{marker}\t", ("item", "marker"))
            inline(" ".join(parts) + "\n", ("item",))
            # a list ends with extra space below it
            if i >= len(lines) or not (lines[i].strip().startswith("- ")
                                       or NUMBERED.match(lines[i].strip())):
                t.insert("end", "\n", ("gap",))
        else:
            parts = []
            while i < len(lines):
                s = lines[i].strip()
                if (not s or s.startswith(("#", "```", "> ", "- "))
                        or NUMBERED.match(s)):
                    break
                parts.append(s)
                i += 1
            inline(" ".join(parts) + "\n", ("para",))
        first = False

    t.configure(state="disabled")
    t.yview_moveto(0)


class HelpWindow(tk.Toplevel):
    """Topic list on the left, rendered help on the right."""

    def __init__(self, master, topics: list[tuple[str, str]]):
        """topics: (title shown in the list, file name in help/)"""
        super().__init__(master)
        self.title("Pi Approximations: Learn")
        self.configure(bg=COLORS["bg"])
        self.geometry("980x720")
        self.minsize(640, 400)
        self.topics = topics

        pane = ttk.Frame(self)
        pane.pack(fill="both", expand=True)
        pane.columnconfigure(1, weight=1)
        pane.rowconfigure(0, weight=1)

        side = tk.Frame(pane, bg="#f4f5f7")
        side.grid(row=0, column=0, sticky="ns")
        tk.Label(side, text="TOPICS", bg="#f4f5f7", fg=COLORS["muted"],
                 font=(SANS, 9, "bold"), anchor="w").pack(fill="x", padx=12, pady=(16, 6))
        self.listbox = tk.Listbox(
            side, activestyle="none", exportselection=False, borderwidth=0,
            highlightthickness=0, font=(SANS, 11), width=24, bg="#f4f5f7",
            fg=COLORS["text"], selectbackground=COLORS["list_sel"],
            selectforeground=COLORS["heading"])
        for title, _ in topics:
            self.listbox.insert("end", "  " + title)
        self.listbox.pack(fill="y", expand=True, padx=(4, 0))
        self.listbox.bind("<<ListboxSelect>>", self._on_select)

        self.text = tk.Text(
            pane, wrap="word", borderwidth=0, highlightthickness=0, padx=28,
            pady=20, bg=COLORS["bg"], fg=COLORS["text"], font=(SANS, 11),
            spacing1=1, spacing2=3, cursor="arrow")
        self.text.grid(row=0, column=1, sticky="nsew")
        scroll = ttk.Scrollbar(pane, orient="vertical", command=self.text.yview)
        scroll.grid(row=0, column=2, sticky="ns")
        self.text.configure(yscrollcommand=scroll.set)
        self._configure_tags()

        self.bind("<Escape>", lambda e: self.destroy())
        for key, delta in (("<Up>", -1), ("<Down>", 1)):
            self.listbox.bind(key, lambda e, d=delta: self._step(d))
        self.bind("<Prior>", lambda e: self.text.yview_scroll(-1, "pages"))
        self.bind("<Next>", lambda e: self.text.yview_scroll(1, "pages"))
        self.current = None

    def _configure_tags(self) -> None:
        t = self.text
        t.tag_configure("h1first", font=(SANS, 20, "bold"), foreground=COLORS["heading"],
                        spacing3=12)
        t.tag_configure("h1", font=(SANS, 20, "bold"), foreground=COLORS["heading"],
                        spacing1=18, spacing3=12)
        t.tag_configure("h2", font=(SANS, 14, "bold"), foreground=COLORS["heading"],
                        spacing1=20, spacing3=6)
        t.tag_configure("h3", font=(SANS, 12, "bold"), foreground=COLORS["heading"],
                        spacing1=14, spacing3=4)
        t.tag_configure("para", spacing3=10)
        t.tag_configure("item", lmargin1=10, lmargin2=34, spacing3=4)
        t.tag_configure("marker", foreground=COLORS["accent"])
        t.tag_configure("gap", font=(SANS, 4))
        t.tag_configure("block", font=(MONO, 11), background=COLORS["block_bg"],
                        lmargin1=22, lmargin2=22, spacing1=0, spacing2=0,
                        spacing3=0, wrap="none")
        t.tag_configure("blockfirst", spacing1=6)
        t.tag_configure("blocklast", spacing3=14)
        t.tag_configure("callout", background=COLORS["callout_bg"], lmargin1=14,
                        lmargin2=14, rmargin=14, spacing1=6, spacing3=14)
        t.tag_configure("bold", font=(SANS, 11, "bold"))
        t.tag_configure("italic", font=(SANS, 11, "italic"))
        t.tag_configure("code", font=(MONO, 10), background=COLORS["code_bg"])
        t.tag_configure("link", foreground=COLORS["accent"], underline=True)
        t.tag_bind("link", "<Enter>", lambda e: t.configure(cursor="hand2"))
        t.tag_bind("link", "<Leave>", lambda e: t.configure(cursor="arrow"))
        t.configure(tabs=("34",))
        t.tag_raise("bold")
        t.tag_raise("italic")
        t.tag_raise("code")
        t.tag_raise("link")

    def show(self, index: int) -> None:
        index = max(0, min(index, len(self.topics) - 1))
        self.listbox.selection_clear(0, "end")
        self.listbox.selection_set(index)
        self.listbox.see(index)
        if index == self.current:
            return
        self.current = index
        title, filename = self.topics[index]
        path = HELP_DIR / filename
        try:
            markdown = path.read_text(encoding="utf-8")
        except OSError:
            markdown = f"# {title}\n\nNo help has been written for this yet.\n\n(Expected `{path}`.)"
        render(self.text, markdown)

    def _on_select(self, _event=None) -> None:
        sel = self.listbox.curselection()
        if sel:
            self.show(sel[0])

    def _step(self, delta: int) -> str:
        self.show((self.current or 0) + delta)
        return "break"
