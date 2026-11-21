// The Learn panel: renders the Markdown files in help/ (the same files the
// Python version uses). Only the Markdown those files use is understood:
//
//   # / ## / ### headings      - bullets          1. numbered items
//   ``` fenced blocks ```      > callouts         **bold** *italic* `code`
//   [text](https://...) links, opened in a new tab

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/;
const LINK = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/;
const NUMBERED = /^(\d+)\.\s+(.*)/;

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s) {
  return s.split(INLINE).map((part) => {
    const link = part.match(LINK);
    if (link)
      return `<a href="${escapeHtml(link[2]).replace(/"/g, "&quot;")}" target="_blank" ` +
             `rel="noopener noreferrer">${escapeHtml(link[1])}</a>`;
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**"))
      return `<strong>${escapeHtml(part.slice(2, -2))}</strong>`;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`"))
      return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*"))
      return `<em>${escapeHtml(part.slice(1, -1))}</em>`;
    return escapeHtml(part);
  }).join("");
}

function isItem(s) {
  return s.startsWith("- ") || NUMBERED.test(s);
}

export function renderMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const out = [];
  let list = null;                         // "ul" or "ol" while inside a list
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };

  let i = 0;
  while (i < lines.length) {
    const stripped = lines[i].trim();
    if (!stripped) { i++; continue; }

    if (isItem(stripped)) {
      const m = stripped.match(NUMBERED);
      const kind = m ? "ol" : "ul";
      if (list !== kind) {
        closeList();
        out.push(m && m[1] !== "1" ? `<ol start="${m[1]}">` : `<${kind}>`);
        list = kind;
      }
      const parts = [m ? m[2] : stripped.slice(2)];
      i++;
      while (i < lines.length && lines[i].startsWith("  ") && lines[i].trim()
             && !isItem(lines[i].trim())) {
        parts.push(lines[i].trim());
        i++;
      }
      out.push(`<li>${inline(parts.join(" "))}</li>`);
      continue;
    }
    closeList();

    if (stripped.startsWith("```")) {
      i++;
      const block = [];
      while (i < lines.length && !lines[i].trim().startsWith("```")) block.push(lines[i++]);
      i++;                                 // closing fence
      out.push(`<pre>${escapeHtml(block.join("\n"))}</pre>`);
    } else if (stripped.startsWith("#")) {
      const level = Math.min(3, stripped.length - stripped.replace(/^#+/, "").length);
      out.push(`<h${level}>${inline(stripped.replace(/^#+/, "").trim())}</h${level}>`);
      i++;
    } else if (stripped.startsWith("> ")) {
      const parts = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        parts.push(lines[i].trim().slice(1).trim());
        i++;
      }
      out.push(`<aside class="callout">${inline(parts.join(" "))}</aside>`);
    } else {
      const parts = [];
      while (i < lines.length) {
        const s = lines[i].trim();
        if (!s || s.startsWith("#") || s.startsWith("```") || s.startsWith("> ") || isItem(s)) break;
        parts.push(s);
        i++;
      }
      out.push(`<p>${inline(parts.join(" "))}</p>`);
    }
  }
  closeList();
  return out.join("\n");
}

// The panel itself. `topics` is a list of [title, file name in help/].
export class HelpPanel {
  constructor(root, topics, onClose) {
    this.root = root;
    this.topics = topics;
    this.onClose = onClose;
    this.current = null;
    this.cache = new Map();
    this.nav = root.querySelector(".help-topics");
    this.article = root.querySelector(".help-body");

    topics.forEach(([title], index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = title;
      button.addEventListener("click", () => this.show(index));
      this.nav.append(button);
    });
    this.nav.addEventListener("keydown", (e) => {
      const delta = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (!delta) return;
      e.preventDefault();
      this.show((this.current ?? 0) + delta);
      this.nav.children[this.current].focus();
    });
    root.querySelector(".help-close").addEventListener("click", () => this.close());
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        this.close();
      }
    });
  }

  get isOpen() {
    return !this.root.hidden;
  }

  open(index) {
    this.root.hidden = false;
    document.body.classList.add("help-open");
    this.show(index);
    this.article.focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen) return;
    this.root.hidden = true;
    document.body.classList.remove("help-open");
    this.onClose?.();
  }

  async show(index) {
    index = Math.max(0, Math.min(index, this.topics.length - 1));
    [...this.nav.children].forEach((b, i) => b.setAttribute("aria-current", i === index));
    if (index === this.current) return;
    this.current = index;
    const [title, file] = this.topics[index];
    let markdown = this.cache.get(file);
    if (markdown === undefined) {
      try {
        const response = await fetch(`help/${file}`);
        if (!response.ok) throw new Error(response.statusText);
        markdown = await response.text();
        this.cache.set(file, markdown);
      } catch {
        markdown = `# ${title}\n\nThis topic could not be loaded. (Expected \`help/${file}\`.)`;
      }
      if (index !== this.current) return;    // another topic was chosen meanwhile
    }
    this.article.innerHTML = renderMarkdown(markdown);
    this.article.scrollTop = 0;
  }
}
