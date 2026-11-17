// Self-contained: the browser serializes this function into the page's isolated world.
export function inspectPage() {
  const sensitive = 'input,textarea,select,option,form,[contenteditable],[data-private],[data-sensitive],[autocomplete],script,style,noscript,iframe,canvas,svg';
  const nodes: Record<string, unknown>[] = [];
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as Element;
      return el.matches(sensitive) || el.closest(sensitive) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  let node = walker.nextNode();
  let chars = 0;
  while (node && nodes.length < 220 && chars < 24_000) {
    const el = node as HTMLElement;
    if (!el.hidden) {
      const text = Array.from(el.childNodes).filter(child => child.nodeType === Node.TEXT_NODE)
        .map(child => child.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim().slice(0, 100)
        .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
        .replace(/\b(?:\d[ -]?){9,}\b/g, '[number]');
      const path: string[] = [];
      let ancestor: Element | null = el;
      for (let depth = 0; ancestor && depth < 5; depth++, ancestor = ancestor.parentElement) {
        let selector = ancestor.tagName.toLowerCase();
        if (ancestor.id && ancestor.id.length < 70) { selector += `#${CSS.escape(ancestor.id)}`; path.unshift(selector); break; }
        const classes = Array.from(ancestor.classList).filter(name => name.length < 55).slice(0, 3);
        selector += classes.map(name => `.${CSS.escape(name)}`).join('');
        path.unshift(selector);
      }
      const item: Record<string, unknown> = { selector: path.join(' > '), tag: el.tagName.toLowerCase(), text };
      if (nodes.length < 45) {
        const style = getComputedStyle(el);
        item.style = { display: style.display, color: style.color, background: style.backgroundColor, fontSize: style.fontSize, maxWidth: style.maxWidth };
      }
      chars += JSON.stringify(item).length;
      nodes.push(item);
    }
    node = walker.nextNode();
  }
  return {
    url: location.origin + location.pathname,
    title: document.title.slice(0, 180),
    viewport: { width: innerWidth, height: innerHeight },
    elements: nodes,
  };
}
