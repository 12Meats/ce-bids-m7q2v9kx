// docmodel.js — bid/document data model. UMD so node:test and the browser both load it.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DocModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return {};
});
