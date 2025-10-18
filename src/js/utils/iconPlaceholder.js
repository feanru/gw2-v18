const ITEM_ICON_PLACEHOLDER_PATH = 'img/item-placeholder.svg';

function getItemIconPlaceholderPath() {
  return ITEM_ICON_PLACEHOLDER_PATH;
}

export { ITEM_ICON_PLACEHOLDER_PATH, getItemIconPlaceholderPath };
export default ITEM_ICON_PLACEHOLDER_PATH;

if (typeof module !== 'undefined' && module.exports) {
  module.exports.ITEM_ICON_PLACEHOLDER_PATH = ITEM_ICON_PLACEHOLDER_PATH;
  module.exports.getItemIconPlaceholderPath = getItemIconPlaceholderPath;
  module.exports.default = ITEM_ICON_PLACEHOLDER_PATH;
}
