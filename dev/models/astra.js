// アストラ（ゲームと同じ形を、モデル確認台で見る）
import { createAstraModel } from '../../src/game/models.js';

export default {
  title: 'Astra（ロボット）',
  create() {
    const m = createAstraModel();
    m.setLight(15, 0);
    const P = m.parts;
    let t = 0;
    return {
      root: m.root,
      update(dt, ctx) {
        t += dt;
        const { walk = 0, face = 'normal', work = false, panic = false, sulk = false } = ctx.params;
        const sw = Math.sin(t * 9) * walk;
        P.body.position.set(0, 0, 0);
        P.torso.rotation.set(work ? 0.18 : 0, 0, 0);
        P.head.rotation.set(sulk ? 0.45 : work ? 0.3 : 0, 0, Math.sin(t * 1.2) * 0.05);
        P.legL.rotation.set(sw * 0.8, 0, 0);
        P.legR.rotation.set(-sw * 0.8, 0, 0);
        P.armL.rotation.set(-sw * 0.6, 0, -0.08);
        P.armR.rotation.set(sw * 0.6, 0, 0.08);
        if (work) { P.armR.rotation.x = -1.3 + Math.sin(t * 11) * 0.7; P.armL.rotation.x = -0.4; }
        if (panic) { P.armL.rotation.set(0, 0, -2.6 + Math.sin(t * 25) * 0.3); P.armR.rotation.set(0, 0, 2.6 - Math.sin(t * 25) * 0.3); }
        if (sulk) { P.body.position.y = -2.5 / 16; P.legL.rotation.set(-1.45, 0, -0.15); P.legR.rotation.set(-1.45, 0, 0.15); }
        m.setFace(face, t);
        m.setAntenna(panic ? 0xff4a3a : sulk ? 0x6a7aa0 : 0x6ff0ff);
        m.setSack(ctx.toggles?.bigSack ? 150 : 20);
      },
    };
  },
  modes: {
    idle: {}, walk: { walk: 1 }, work: { work: true, face: 'work' }, happy: { face: 'happy' },
    scared: { panic: true, face: 'scared', walk: 1.5 }, sulk: { sulk: true, face: 'sad' }, sleep: { face: 'sleep' },
  },
  toggles: { bigSack: { on: false, set: () => {} } },
  views: { face: { pos: [0, 1.0, 1.6], target: [0, 0.95, 0], fov: 30 } },
  background: '#9fc8ef',
};
