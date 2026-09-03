// bidmath.js — pure pricing math. UMD so node:test and the browser both load it.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BidMath = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return {};
});
