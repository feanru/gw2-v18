import assert from 'assert';

const originalDocument = global.document;

class TestFragment {
  constructor() {
    this.children = [];
    this.isFragment = true;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

class TestElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.style = {};
    this._className = '';
    this._innerHTML = '';
    this.textContent = '';
  }

  appendChild(child) {
    if (!child) return child;
    if (child.isFragment) {
      child.children.forEach((node) => this.appendChild(node));
      return child;
    }
    this.children.push(child);
    return child;
  }

  set className(value) {
    this._className = value;
    this.attributes.class = value;
  }

  get className() {
    return this._className || '';
  }

  set alt(value) {
    this.attributes.alt = value;
  }

  get alt() {
    return this.attributes.alt || '';
  }

  set src(value) {
    this.attributes.src = value;
  }

  get src() {
    return this.attributes.src || '';
  }

  set innerHTML(value) {
    this._innerHTML = value;
    if (value === '') {
      this.children = [];
    }
  }

  get innerHTML() {
    return this._innerHTML || '';
  }
}

class TestDocument {
  constructor() {
    this._elementsById = new Map();
  }

  createElement(tagName) {
    return new TestElement(tagName);
  }

  createDocumentFragment() {
    return new TestFragment();
  }

  registerElement(element, id) {
    if (id) {
      element.id = id;
    }
    if (element?.id) {
      this._elementsById.set(element.id, element);
    }
    return element;
  }

  getElementById(id) {
    return this._elementsById.get(id) || null;
  }
}

const documentStub = new TestDocument();
const resultsEl = documentStub.registerElement(new TestElement('div'), 'modal-results');

global.document = documentStub;

const [coreModule, placeholderModule] = await Promise.all([
  import('../src/js/search-modal-core.js'),
  import('../src/js/utils/iconPlaceholder.js'),
]);

const { createResultRenderer } = coreModule;
const { getItemIconPlaceholderPath } = placeholderModule;

const placeholderPath = getItemIconPlaceholderPath();

const iconCache = {
  999: { src: placeholderPath, isFallback: true },
};
const rarityCache = {};

const renderResults = createResultRenderer({
  resultsEl,
  iconCache,
  rarityCache,
  onSelect: () => {},
});

renderResults([
  {
    id: 999,
    name_es: 'Objeto sin icono',
    buy_price: null,
    sell_price: null,
  },
], true);

assert.strictEqual(resultsEl.children.length, 1, 'Should render one card');
const card = resultsEl.children[0];
const img = card.children.find((child) => child.tagName === 'IMG');
assert.ok(img, 'Card should contain an image');
assert.strictEqual(img.src, placeholderPath, 'Image should use the placeholder path');
assert.ok(img.className.split(/\s+/).includes('item-icon--placeholder'), 'Placeholder class should be applied');
assert.strictEqual(img.alt, 'Icono no disponible', 'Placeholder alt text should be set');

if (originalDocument === undefined) {
  delete global.document;
} else {
  global.document = originalDocument;
}

console.log('search-modal placeholder render test passed');
