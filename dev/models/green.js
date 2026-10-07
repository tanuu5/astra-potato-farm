// 緑のアレ
import { createGreenModel } from '../../src/game/models.js';

export default {
  title: '緑のアレ',
  create() {
    const m = createGreenModel();
    m.mat.uniforms.uLight.value.set(1, 0);
    let t = 0;
    return {
      root: m.root,
      update(dt, ctx) {
        t += dt;
        const { walk = 0, fuse = 0 } = ctx.params;
        const sw = Math.sin(t * 9) * 0.6 * walk;
        m.legs[0].rotation.x = sw; m.legs[3].rotation.x = sw; m.legs[1].rotation.x = -sw; m.legs[2].rotation.x = -sw;
        const s = m.baseScale * (1 + fuse * 0.2);
        m.scale.scale.set(s, s, s);
        m.mat.uniforms.uFlash.value = fuse && Math.sin(t * 20) > 0 ? 0.7 : 0;
      },
    };
  },
  modes: { idle: {}, walk: { walk: 1 }, fuse: { fuse: 1 } },
  background: '#9fc8ef',
};
