/**
 * 地球纹理注册表 — 纹理来源为本地图片文件
 * 所有纹理均为等距柱状投影（equirectangular）
 *
 * 纹理来源：Solar System Scope (CC BY 4.0)
 * https://www.solarsystemscope.com/textures/
 */

const textureRegistry = [
  {
    id: 'blue-marble',
    name: '蓝色弹珠',
    url: './assets/earth-blue-marble.jpg',
    thumbUrl: './assets/2k_earth_daymap.jpg'
  },
  {
    id: 'daymap',
    name: '日间',
    url: './assets/2k_earth_daymap.jpg',
    thumbUrl: './assets/2k_earth_daymap.jpg'
  },
  {
    id: 'nightmap',
    name: '夜间',
    url: './assets/2k_earth_nightmap.jpg',
    thumbUrl: './assets/2k_earth_nightmap.jpg'
  },
  {
    id: 'clouds',
    name: '云层',
    url: './assets/2k_earth_clouds.jpg',
    thumbUrl: './assets/2k_earth_clouds.jpg'
  },
];

export function getAllTextures() {
  return textureRegistry;
}

export function getDefaultTextureId() {
  return 'blue-marble';
}
