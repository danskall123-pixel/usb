// Демо-проект и переиспользуемый персонаж на костях (гибкая привязка, привязка слоёв, IK-готовый скелет).
import { newDoc, newLayer, newPoint, newPath, newBone } from './model.js';
import { setKey } from './anim.js';
import { hex2rgb, OVAL_CURV } from './util.js';

export const C = (hex, a = 1) => [...hex2rgb(hex), a];
export const style = (fill, stroke, width, hf = !!fill, hs = !!stroke) => ({ fill: fill ? C(fill) : [0, 0, 0, 1], stroke: stroke ? C(stroke) : [0, 0, 0, 1], width, hf, hs });
export const oval = (cx, cy, rx, ry) => [[cx + rx, cy, OVAL_CURV], [cx, cy + ry, OVAL_CURV], [cx - rx, cy, OVAL_CURV], [cx, cy - ry, OVAL_CURV]];
export const star = (cx, cy, n, r1, r2) => Array.from({ length: n * 2 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / n, r = i % 2 ? r2 : r1; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0]; });

// Контур из списка [x, y, кривизна?, толщина?]; bone — жёсткая привязка всех точек к кости
export function makePath(d, pts, closed, st, bone = null) {
  const ps = pts.map(([x, y, c = 1, w = 1]) => { const p = newPoint(d, x, y, c, w); p.bone = bone; return p; });
  return newPath(d, ps, closed, st);
}

export const CHARACTER_COLORS = {
  shirt: '#4c7bff', shirtDark: '#3a63d6', outline: '#22357a',
  skin: '#f6c99f', skinDark: '#8d5a3b', hair: '#5b3a29', hairDark: '#3b2418',
  pants: '#2d3a55', shoes: '#24262b', eyes: '#1d1d24',
};

// Персонаж: слой костей с телом, головой, глазами, руками и ногами (ступни на y = 207 от точки слоя).
// opts: { name, x, y, colors: частично CHARACTER_COLORS }. Возвращает { rig, bones, layers }.
export function buildCharacter(d, opts = {}) {
  const col = { ...CHARACTER_COLORS, ...(opts.colors || {}) };
  const P = (pts, closed, st, bone) => makePath(d, pts, closed, st, bone);
  const rig = newLayer(d, 'bone', opts.name || 'Персонаж');
  rig.showStr = false;
  if (opts.x || opts.y) rig.pos.k[0].v = [opts.x || 0, opts.y || 0];
  const B = (parent, x, y, ang, len, name, str) => { const b = newBone(d, parent ? parent.id : null, x, y, ang, len); b.name = name; b.str = str; rig.bones.push(b); return b; };
  const body = B(null, 0, 110, -90, 100, 'Корпус', 20);
  const head = B(body, 100, 0, 0, 75, 'Голова', 20);
  const armR = B(body, 92, 38, 165, 62, 'Плечо (ближнее)', 34);
  const foreR = B(armR, 62, 0, 0, 55, 'Предплечье (ближнее)', 34);
  const armL = B(body, 92, -38, 195, 62, 'Плечо (дальнее)', 34);
  const foreL = B(armL, 62, 0, 0, 55, 'Предплечье (дальнее)', 34);
  const legR = B(null, 18, 110, 90, 95, 'Нога (ближняя)', 30);
  const legL = B(null, -18, 110, 90, 95, 'Нога (дальняя)', 30);

  const farArm = newLayer(d, 'vector', 'Рука (дальняя)');
  farArm.paths.push(P([[-38, 18], [-46, 48], [-54, 78], [-61, 104], [-68, 128]], false, style(null, col.shirtDark, 20)));
  farArm.paths.push(P(oval(-69, 138, 10, 10), true, style(col.skin, col.skinDark, 2.5), foreL.id));

  const legs = newLayer(d, 'vector', 'Ноги');
  legs.paths.push(P([[-18, 110], [-19, 158], [-20, 200]], false, style(null, col.pants, 22)));
  legs.paths.push(P([[18, 110], [19, 158], [20, 200]], false, style(null, col.pants, 22)));
  legs.paths.push(P(oval(-28, 207, 19, 9), true, style(col.shoes, null, 0), legL.id));
  legs.paths.push(P(oval(28, 207, 19, 9), true, style(col.shoes, null, 0), legR.id));

  const torso = newLayer(d, 'vector', 'Туловище');
  torso.paths.push(P([[-42, 22], [0, 8], [42, 22], [47, 70], [36, 122], [0, 128], [-36, 122], [-47, 70]], true, style(col.shirt, col.outline, 4)));
  torso.paths.push(P([[-14, 12], [0, 26], [14, 12]], false, style(null, col.outline, 3)));
  torso.bind = body.id;

  const headL = newLayer(d, 'vector', 'Голова');
  headL.paths.push(P(oval(0, -40, 40, 41), true, style(col.skin, col.skinDark, 4)));
  headL.paths.push(P([[-41, -44], [-34, -74], [-6, -88], [26, -82], [42, -50], [24, -64], [4, -58], [-18, -66]], true, style(col.hair, col.hairDark, 3)));
  headL.paths.push(P([[-15, -22], [0, -15], [15, -22]], false, style(null, col.skinDark, 3.5)));
  headL.bind = head.id;

  const eyes = newLayer(d, 'vector', 'Глаза');
  eyes.paths.push(P(oval(-14, -42, 5.5, 6.5), true, style(col.eyes, null, 0)));
  eyes.paths.push(P(oval(14, -42, 5.5, 6.5), true, style(col.eyes, null, 0)));
  eyes.bind = head.id;
  eyes.origin = [0, -42];

  const nearArm = newLayer(d, 'vector', 'Рука (ближняя)');
  nearArm.paths.push(P([[38, 18], [46, 48], [54, 78], [61, 104], [68, 128]], false, style(null, col.shirt, 20)));
  nearArm.paths.push(P(oval(69, 138, 10, 10), true, style(col.skin, col.skinDark, 2.5), foreR.id));

  rig.children.push(farArm, legs, torso, headL, eyes, nearArm);
  return {
    rig,
    bones: { body, head, armR, foreR, armL, foreL, legR, legL },
    layers: { farArm, legs, torso, head: headL, eyes, nearArm },
  };
}

export function buildDemo() {
  const d = newDoc();
  d.name = 'Пример — персонаж машет';
  d.end = 48;
  d.bg = '#bfe4ff';
  const P = (pts, closed, st, bone = null) => makePath(d, pts, closed, st, bone);

  // ---- фон ----
  const sun = newLayer(d, 'vector', 'Солнце');
  sun.paths.push(P(star(-460, -210, 12, 96, 66), true, style('#ffe58a', null, 0)));
  sun.paths.push(P(oval(-460, -210, 52, 52), true, style('#ffd44d', '#f0a623', 4)));
  sun.origin = [-460, -210];
  setKey(sun.rot, 48, 90, 'linear');
  sun.rot.k[0].i = 'linear';

  const cloud = newLayer(d, 'vector', 'Облако');
  cloud.paths.push(P([[220, -208], [236, -246], [278, -264], [318, -252], [352, -272], [392, -250], [404, -214], [362, -198], [300, -204], [252, -196]], true, style('#ffffff', '#d3e6f7', 3)));
  cloud.paths.push(P([[-60, -268], [-40, -292], [-6, -296], [24, -284], [36, -262], [0, -252], [-34, -254]], true, style('#ffffff', '#d3e6f7', 3)));
  setKey(cloud.pos, 24, [40, 0]);
  setKey(cloud.pos, 48, [0, 0]);

  const ground = newLayer(d, 'vector', 'Земля');
  ground.paths.push(P([[-660, 190, 0], [-320, 165], [0, 198], [330, 170], [660, 192, 0], [660, 380, 0], [-660, 380, 0]], true, style('#8fd16b', '#5a9a3e', 5)));
  ground.paths.push(P([[-520, 232], [-500, 214], [-470, 230]], false, style(null, '#5a9a3e', 4)));
  ground.paths.push(P([[420, 250], [440, 230], [470, 246]], false, style(null, '#5a9a3e', 4)));

  const shadow = newLayer(d, 'vector', 'Тень');
  shadow.paths.push(P(oval(0, 210, 78, 13), true, { ...style('#000000', null, 0), fill: [20, 40, 20, 0.22] }));
  shadow.blur = 4;

  // ---- персонаж и анимация ----
  const { rig, bones: b, layers } = buildCharacter(d, { name: 'Персонаж' });
  for (const [f, s] of [[28, 1], [30, 0.1], [32, 1]]) setKey(layers.eyes.scl, f, [1, s], 'linear');
  layers.eyes.scl.k[0].i = 'linear';
  const keys = (ch, list, i) => { for (const [f, v] of list) setKey(ch, f, v, i); };
  keys(b.armR.ang, [[8, 40], [40, 40], [48, 165]]);
  keys(b.foreR.ang, [[8, -40], [14, 12], [20, -40], [26, 12], [32, -40], [40, -10], [48, 0]]);
  keys(b.armL.ang, [[24, 186], [48, 195]]);
  keys(b.head.ang, [[12, -8], [24, 6], [36, -6], [48, 0]]);
  keys(b.body.ang, [[24, -86], [48, -90]]);
  keys(b.foreL.ang, [[24, -12], [48, 0]]);

  d.layers.push(sun, cloud, ground, shadow, rig);
  return d;
}
