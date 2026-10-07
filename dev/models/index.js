// 確認台に出すモデルの一覧。名前 → アダプターを読み込む関数。
// viewer.html?m=<名前> で最初に出すものを選べる（省略時は先頭）。
export default {
  astra: () => import('./astra.js'),
  green: () => import('./green.js'),
};
