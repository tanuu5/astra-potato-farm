// ブロックの種類。見た目（タイル名と形）と、当たり・光・爆発での壊れやすさを 1 か所に書く。
//   shape：cube（ふつうの立方体）／low（15/16 の高さ：畑・小道）／half（ベッド）／cross（草・花・サトウキビ）／
//          crop（じゃがいも：# の形）／water／lantern（小さな箱）
//   full：まわりの面を隠す立方体か　opaque：光をさえぎるか　solid：ぶつかるか（h はぶつかる高さ）
//   blast：爆発で消えるか　green：アストラがこわがる緑のもの　light：明るさ（0〜15）

export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, FARM: 3, FARM_WET: 4, STONE: 5, SAND: 6, WATER: 7, LOG: 8, LEAVES: 9,
  PLANKS: 10, COBBLE: 11, GLASS: 12, LANTERN: 13, TALLGRASS: 14, FLOWER_R: 15, FLOWER_Y: 16, CANE: 17,
  POTATO0: 18, POTATO1: 19, POTATO2: 20, POTATO3: 21, BED: 22, HAY: 23, BEDROCK: 24, BOX: 25, MELON: 26,
  PATH: 27, GRAVEL: 28, BED_FOOT: 29,
};

const cube = (tex, o = {}) => ({ shape: 'cube', tex, full: true, opaque: true, solid: true, blast: true, ...o });
const plant = (tex, o = {}) => ({ shape: 'cross', tex, full: false, opaque: false, solid: false, blast: true, plant: true, ...o });
const crop = (stage) => ({ shape: 'crop', tex: 'potato' + stage, full: false, opaque: false, solid: false, blast: true, crop: stage, particle: 0x5d9e3a });

export const BLOCKS = [];
BLOCKS[B.AIR] = { shape: 'none', full: false, opaque: false, solid: false, blast: false };
BLOCKS[B.GRASS] = cube({ top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, { particle: 0x6aae43, restore: B.GRASS });
BLOCKS[B.DIRT] = cube('dirt', { particle: 0x8a6142, restore: B.DIRT });
BLOCKS[B.FARM] = cube({ top: 'farm_dry', side: 'dirt', bottom: 'dirt' }, { shape: 'low', full: false, h: 15 / 16, particle: 0x7a5636, farm: true, restore: B.DIRT });
BLOCKS[B.FARM_WET] = cube({ top: 'farm_wet', side: 'dirt', bottom: 'dirt' }, { shape: 'low', full: false, h: 15 / 16, particle: 0x4f3522, farm: true, wet: true, restore: B.DIRT });
BLOCKS[B.STONE] = cube('stone', { particle: 0x7d7d7d, restore: B.STONE });
BLOCKS[B.SAND] = cube('sand', { particle: 0xdbd3a0, restore: B.SAND });
BLOCKS[B.WATER] = { shape: 'water', tex: 'water', full: false, opaque: false, solid: false, blast: false, liquid: true, skyAtten: 2 };
BLOCKS[B.LOG] = cube({ top: 'log_top', side: 'log_side', bottom: 'log_top' }, { particle: 0x6b5233, blast: false });
BLOCKS[B.LEAVES] = cube('leaves', { full: false, opaque: false, cutout: true, particle: 0x4a9a32, skyAtten: 1, green: false });
BLOCKS[B.PLANKS] = cube('planks', { particle: 0xa47d4c, blast: false });
BLOCKS[B.COBBLE] = cube('cobble', { particle: 0x8a8a8a, blast: false });
BLOCKS[B.GLASS] = cube('glass', { full: false, opaque: false, cutout: true, particle: 0xd5ecf0, blast: false, glass: true });
BLOCKS[B.LANTERN] = { shape: 'lantern', tex: 'lantern', full: false, opaque: false, solid: false, blast: false, light: 14, particle: 0xffd27a };
BLOCKS[B.TALLGRASS] = plant('tallgrass', { particle: 0x5d9e3a });
BLOCKS[B.FLOWER_R] = plant('flower_r', { particle: 0xd23a3a });
BLOCKS[B.FLOWER_Y] = plant('flower_y', { particle: 0xf0d040 });
BLOCKS[B.CANE] = plant('cane', { particle: 0x8fcf5a, green: 'cane' });
BLOCKS[B.POTATO0] = crop(0);
BLOCKS[B.POTATO1] = crop(1);
BLOCKS[B.POTATO2] = crop(2);
BLOCKS[B.POTATO3] = crop(3);
BLOCKS[B.BED] = cube({ top: 'bed_top', side: 'bed_side', bottom: 'planks' }, { shape: 'half', full: false, opaque: false, h: 9 / 16, particle: 0xb83232, blast: false });
BLOCKS[B.BED_FOOT] = cube({ top: 'bed_foot', side: 'bed_side', bottom: 'planks' }, { shape: 'half', full: false, opaque: false, h: 9 / 16, particle: 0xb83232, blast: false });
BLOCKS[B.HAY] = cube({ top: 'hay_top', side: 'hay_side', bottom: 'hay_top' }, { particle: 0xd8b24a, blast: false });
BLOCKS[B.BEDROCK] = cube('bedrock', { particle: 0x3a3a3a, blast: false });
BLOCKS[B.BOX] = cube({ top: 'box_top', side: 'box_side', bottom: 'planks' }, { particle: 0xa47d4c, blast: false });
BLOCKS[B.MELON] = cube({ top: 'melon_top', side: 'melon_side', bottom: 'melon_top' }, { particle: 0x6f9a2a, green: 'melon', blast: false });
BLOCKS[B.PATH] = cube({ top: 'path_top', side: 'path_side', bottom: 'dirt' }, { shape: 'low', full: false, h: 15 / 16, particle: 0x9c7f4a, restore: B.PATH });
BLOCKS[B.GRAVEL] = cube('gravel', { particle: 0x847c78, restore: B.GRAVEL });

for (const d of BLOCKS) {
  if (!d) continue;
  d.h ??= 1;
  d.skyAtten ??= 0;
  d.light ??= 0;
  d.particle ??= 0x888888;
}

export const isCrop = (id) => id >= B.POTATO0 && id <= B.POTATO3;
export const cropStage = (id) => (isCrop(id) ? id - B.POTATO0 : -1);
export const isFarm = (id) => id === B.FARM || id === B.FARM_WET;
/** 植物（草・花・サトウキビ・作物）：上にある土がなくなったら一緒に消える。 */
export const needsSupport = (id) => !!BLOCKS[id]?.plant || isCrop(id);
