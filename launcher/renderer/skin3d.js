// The player preview: skinview3d's model, with the skin's second layer rebuilt out of little cubes the way the
// pack's 3D Skin Layers mod shows it in game.
import * as THREE from 'three';
import { SkinViewer, IdleAnimation } from 'skinview3d';

// a Minecraft box's UV layout: where each face of a w×h×d box sits on the texture, from the box's corner (u, v)
function faces(u, v, w, h, d) {
  return [
    // [texture x, texture y, width, height, pixel (i, j) -> position on the box surface, one pixel outside it]
    [u + d, v + d, w, h, (i, j) => [-w / 2 + i + 0.5, h / 2 - j - 0.5, d / 2 + 0.5]],             // front
    [u + 2 * d + w, v + d, w, h, (i, j) => [w / 2 - i - 0.5, h / 2 - j - 0.5, -d / 2 - 0.5]],      // back
    [u, v + d, d, h, (i, j) => [-w / 2 - 0.5, h / 2 - j - 0.5, -d / 2 + i + 0.5]],                // right side
    [u + d + w, v + d, d, h, (i, j) => [w / 2 + 0.5, h / 2 - j - 0.5, d / 2 - i - 0.5]],           // left side
    [u + d, v, w, d, (i, j) => [-w / 2 + i + 0.5, h / 2 + 0.5, -d / 2 + j + 0.5]],                // top
    [u + d + w, v, w, d, (i, j) => [-w / 2 + i + 0.5, -h / 2 - 0.5, d / 2 - j - 0.5]],             // bottom
  ];
}

const CUBE = new THREE.BoxGeometry(1, 1, 1);
const MATERIAL = new THREE.MeshStandardMaterial();

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function createPreview(canvas) {
  const viewer = new SkinViewer({ canvas, width: canvas.clientWidth || 300, height: canvas.clientHeight || 480 });
  viewer.background = null;
  viewer.renderer.setClearColor(0x000000, 0);   // see-through, so the End shows behind the player
  viewer.fov = 38;
  viewer.zoom = 0.6;
  viewer.autoRotate = true;
  viewer.autoRotateSpeed = 0.5;
  viewer.animation = new IdleAnimation();
  viewer.controls.enableZoom = false;
  viewer.controls.enablePan = false;
  viewer.controls.addEventListener('start', () => (viewer.autoRotate = false));
  viewer.controls.addEventListener('end', () => setTimeout(() => (viewer.autoRotate = true), 2500));

  let voxels = [];

  function buildLayer(img) {
    voxels.forEach(m => { m.parent?.remove(m); m.dispose(); });
    voxels = [];
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, 64, 64).data;
    const legacy = img.height === 32;   // old skins have a second layer on the head only
    const skin = viewer.playerObject.skin;
    const parts = [
      [skin.head, 32, 0], [skin.body, 16, 32], [skin.rightArm, 40, 32],
      [skin.leftArm, 48, 48], [skin.rightLeg, 0, 32], [skin.leftLeg, 0, 48],
    ];
    for (const [part, u, v] of parts) {
      part.outerLayer.visible = false;
      if (legacy && part !== skin.head) continue;
      const inner = part.innerLayer;
      const p = inner.geometry.parameters;
      const w = Math.round(p.width * inner.scale.x), h = Math.round(p.height * inner.scale.y), d = Math.round(p.depth * inner.scale.z);
      const cubes = [];
      for (const [fx, fy, fw, fh, at] of faces(u, v, w, h, d)) {
        for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) {
          const k = ((fy + j) * 64 + fx + i) * 4;
          if (px[k + 3] < 128) continue;
          cubes.push([at(i, j), px[k], px[k + 1], px[k + 2]]);
        }
      }
      if (!cubes.length) continue;
      const mesh = new THREE.InstancedMesh(CUBE, MATERIAL, cubes.length);
      const m = new THREE.Matrix4();
      const color = new THREE.Color();
      cubes.forEach(([[x, y, z], r, gr, b], n) => {
        mesh.setMatrixAt(n, m.makeTranslation(inner.position.x + x, inner.position.y + y, inner.position.z + z));
        mesh.setColorAt(n, color.setRGB(r / 255, gr / 255, b / 255, THREE.SRGBColorSpace));
      });
      inner.parent.add(mesh);
      voxels.push(mesh);
    }
  }

  return {
    async show({ skin, model, cape }) {
      if (skin) {
        const img = await loadImage(skin);
        viewer.loadSkin(img, { model: model === 'slim' ? 'slim' : 'default' });
        buildLayer(img);
      } else viewer.loadSkin(null);
      if (cape) viewer.loadCape(await loadImage(cape));
      else viewer.loadCape(null);
    },
    resize(width, height) {
      viewer.setSize(width, height);
    },
  };
}
