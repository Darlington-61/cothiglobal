/*
 * COTHI CBT - Offline math & rich-content renderer (CBTMath)
 * ----------------------------------------------------------
 * Self-contained: no network, no external fonts. Renders a practical LaTeX
 * subset (fractions, powers, subscripts, roots, Greek letters, common
 * operators) written between $...$ (inline) or $$...$$ (block), plus any of
 * the \command symbols below typed directly. Plain text is HTML-escaped, so
 * untrusted question/option content cannot inject markup.
 *
 * If a full KaTeX build is ever bundled (window.katex present), it is used
 * automatically for higher-fidelity output; otherwise the built-in renderer
 * is used. Either way everything works 100% offline.
 */
(function () {
  if (window.CBTMath) return;

  var SYMBOLS = {
    '\\times': '×', '\\div': '÷', '\\pm': '±', '\\mp': '∓',
    '\\cdot': '·', '\\ast': '∗', '\\star': '⋆',
    '\\leq': '≤', '\\le': '≤', '\\geq': '≥', '\\ge': '≥',
    '\\neq': '≠', '\\ne': '≠', '\\approx': '≈', '\\equiv': '≡',
    '\\sim': '∼', '\\propto': '∝', '\\cong': '≅',
    '\\infty': '∞', '\\degree': '°', '\\prime': '′',
    '\\sum': '∑', '\\prod': '∏', '\\int': '∫', '\\oint': '∮',
    '\\partial': '∂', '\\nabla': '∇', '\\sqrt': '√',
    '\\pi': 'π', '\\Pi': 'Π', '\\theta': 'θ', '\\Theta': 'Θ',
    '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\Gamma': 'Γ',
    '\\delta': 'δ', '\\Delta': 'Δ', '\\epsilon': 'ε', '\\varepsilon': 'ε',
    '\\zeta': 'ζ', '\\eta': 'η', '\\lambda': 'λ', '\\Lambda': 'Λ',
    '\\mu': 'μ', '\\nu': 'ν', '\\xi': 'ξ', '\\rho': 'ρ',
    '\\sigma': 'σ', '\\Sigma': 'Σ', '\\tau': 'τ', '\\phi': 'φ',
    '\\Phi': 'Φ', '\\varphi': 'φ', '\\chi': 'χ', '\\psi': 'ψ',
    '\\Psi': 'Ψ', '\\omega': 'ω', '\\Omega': 'Ω',
    '\\rightarrow': '→', '\\to': '→', '\\leftarrow': '←',
    '\\Rightarrow': '⇒', '\\Leftarrow': '⇐', '\\leftrightarrow': '↔',
    '\\uparrow': '↑', '\\downarrow': '↓', '\\mapsto': '↦',
    '\\angle': '∠', '\\perp': '⊥', '\\parallel': '∥', '\\triangle': '△',
    '\\in': '∈', '\\notin': '∉', '\\ni': '∋', '\\subset': '⊂',
    '\\subseteq': '⊆', '\\supset': '⊃', '\\supseteq': '⊇',
    '\\cup': '∪', '\\cap': '∩', '\\emptyset': '∅', '\\varnothing': '∅',
    '\\forall': '∀', '\\exists': '∃', '\\neg': '¬',
    '\\land': '∧', '\\lor': '∨', '\\oplus': '⊕', '\\otimes': '⊗',
    '\\therefore': '∴', '\\because': '∵',
    '\\ldots': '…', '\\cdots': '⋯', '\\dots': '…',
    '\\%': '%', '\\&': '&', '\\#': '#', '\\$': '$', '\\{': '{', '\\}': '}',
    '\\ ': ' ', '\\,': ' ', '\\;': ' '
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function escText(s) {
    return esc(s).replace(/\n/g, '<br>');
  }

  // Convert a LaTeX-subset string into safe HTML.
  function texToHtml(src) {
    src = String(src);
    var i = 0;

    function parseUntil(stop) {
      var out = '';
      while (i < src.length && src[i] !== stop) {
        out += parseToken();
      }
      if (stop && src[i] === stop) i++;
      return out;
    }

    function readGroup() {
      if (src[i] === '{') { i++; return parseUntil('}'); }
      return parseToken();
    }

    function parseToken() {
      var c = src[i];
      if (c === '\\') {
        var rest = src.slice(i + 1);
        var m = /^[a-zA-Z]+/.exec(rest);
        if (m) {
          var name = '\\' + m[0];
          i += 1 + m[0].length;
          if (name === '\\frac' || name === '\\dfrac' || name === '\\tfrac') {
            var n = readGroup(), d = readGroup();
            return '<span class="cbt-frac"><span class="cbt-frac-n">' + n +
              '</span><span class="cbt-frac-d">' + d + '</span></span>';
          }
          if (name === '\\sqrt') {
            var idx = '';
            if (src[i] === '[') { i++; idx = parseUntil(']'); }
            var r = readGroup();
            var idxHtml = idx ? '<sup class="cbt-root-idx">' + idx + '</sup>' : '';
            return '<span class="cbt-sqrt">' + idxHtml +
              '<span class="cbt-sqrt-sym">√</span>' +
              '<span class="cbt-sqrt-r">' + r + '</span></span>';
          }
          if (name === '\\text' || name === '\\mathrm' || name === '\\mathbf' || name === '\\mathit') {
            return readGroup();
          }
          if (name === '\\left' || name === '\\right') {
            return ''; // delimiters handled as literal chars that follow
          }
          if (SYMBOLS[name] !== undefined) return SYMBOLS[name];
          return esc(name); // unknown command shown literally
        } else {
          var ch = src[i] || '';
          i++;
          return SYMBOLS['\\' + ch] !== undefined ? SYMBOLS['\\' + ch] : esc(ch);
        }
      }
      if (c === '^') { i++; return '<sup>' + readGroup() + '</sup>'; }
      if (c === '_') { i++; return '<sub>' + readGroup() + '</sub>'; }
      if (c === '{') { i++; return parseUntil('}'); }
      if (c === '}') { i++; return ''; }
      i++;
      return esc(c);
    }

    return parseUntil(null);
  }

  function katexAvailable() {
    return typeof window.katex !== 'undefined' && window.katex && typeof window.katex.renderToString === 'function';
  }

  function renderMath(code, isBlock) {
    if (katexAvailable()) {
      try {
        return window.katex.renderToString(code, { displayMode: !!isBlock, throwOnError: false });
      } catch (e) { /* fall through to built-in */ }
    }
    return '<span class="cbt-math' + (isBlock ? ' cbt-math-block' : '') + '">' + texToHtml(code) + '</span>';
  }

  // Render a string that may mix plain text and $...$ / $$...$$ math into safe HTML.
  function renderInline(str) {
    if (str == null) return '';
    str = String(str);
    var out = '', i = 0;
    while (i < str.length) {
      if (str[i] === '$') {
        var dbl = str[i + 1] === '$';
        var token = dbl ? '$$' : '$';
        var close = str.indexOf(token, i + token.length);
        if (close === -1) { out += escText(str.slice(i)); break; }
        var code = str.slice(i + token.length, close);
        out += renderMath(code, dbl);
        i = close + token.length;
      } else {
        var next = str.indexOf('$', i);
        if (next === -1) next = str.length;
        out += escText(str.slice(i, next));
        i = next;
      }
    }
    return out;
  }

  // Set an element's content from a rich string (text + math). Safe (escaped).
  function applyTo(el, str) {
    if (!el) return;
    el.innerHTML = renderInline(str);
  }

  // Render a reading passage / cloze into an element: math + text, with blank
  // markers ___(1)___ , ___1___ or [[1]] turned into styled numbered blanks.
  function renderPassageInto(el, str) {
    if (!el) return;
    var html = renderInline(str);
    html = html.replace(/_{2,}\s*\(?\s*(\d{1,3})\s*\)?\s*_{2,}/g, function (_m, n) {
      return '<span class="cbt-blank">' + esc(n) + '</span>';
    });
    html = html.replace(/\[\[\s*(\d{1,3})\s*\]\]/g, function (_m, n) {
      return '<span class="cbt-blank">' + esc(n) + '</span>';
    });
    el.innerHTML = html;
  }

  var IMG_RE = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/=\s]+$/i;
  function isImage(url) {
    return typeof url === 'string' && IMG_RE.test(url.trim());
  }
  // Build an <img> (via property assignment, never innerHTML) or return null.
  function makeImg(url, className) {
    if (!isImage(url)) return null;
    var img = document.createElement('img');
    img.className = className || 'cbt-img';
    img.src = url.trim();
    img.alt = 'figure';
    return img;
  }

  function injectCss() {
    if (document.getElementById('cbt-math-css')) return;
    var css =
      '.cbt-math{white-space:normal}' +
      '.cbt-math-block{display:block;text-align:center;margin:8px 0;font-size:1.1em}' +
      '.cbt-frac{display:inline-flex;flex-direction:column;vertical-align:middle;text-align:center;margin:0 .15em;line-height:1.05}' +
      '.cbt-frac-n{border-bottom:1.5px solid currentColor;padding:0 .3em}' +
      '.cbt-frac-d{padding:0 .3em}' +
      '.cbt-sqrt{display:inline-flex;align-items:flex-start;white-space:nowrap}' +
      '.cbt-sqrt-sym{font-size:1.05em}' +
      '.cbt-sqrt-r{border-top:1.5px solid currentColor;padding:0 .15em;margin-top:1px}' +
      '.cbt-root-idx{font-size:.65em;margin-right:-.3em;align-self:flex-start}' +
      '.cbt-img{display:block;max-width:100%;max-height:340px;height:auto;margin:10px 0;border:1px solid #e2e8f0;border-radius:8px;background:#fff}' +
      '.cbt-opt-img{display:block;max-width:100%;max-height:170px;height:auto;margin:6px 0 0;border-radius:6px}' +
      '.cbt-passage{background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid #2563eb;border-radius:8px;padding:12px 14px;margin:0 0 14px;line-height:1.6;white-space:normal;max-height:40vh;overflow:auto}' +
      '.cbt-passage-title{font-weight:700;margin:0 0 6px;color:#1e3a8a}' +
      '.cbt-blank{display:inline-block;min-width:34px;text-align:center;border-bottom:2px solid #2563eb;color:#2563eb;font-weight:700;margin:0 2px}';
    var style = document.createElement('style');
    style.id = 'cbt-math-css';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectCss);
  } else {
    injectCss();
  }

  window.CBTMath = {
    renderInline: renderInline,
    applyTo: applyTo,
    renderPassageInto: renderPassageInto,
    texToHtml: texToHtml,
    isImage: isImage,
    makeImg: makeImg,
    injectCss: injectCss
  };
})();
