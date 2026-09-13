import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

// Renders a character model (glTF/.glb with color, or .stl as a flat-colored
// shape) in a small rotating 3D viewport. Falls back to nothing (parent
// should show a circle avatar instead) if no modelFile is given.
export default function Avatar3D({ modelFile, accessoryFile, stlColor = "#c9a876", size = 160 }) {
  const mountRef = useRef(null);

  useEffect(() => {
    if (!modelFile || !mountRef.current) return undefined;
    const mount = mountRef.current;
    const isStl = modelFile.toLowerCase().endsWith(".stl");

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(size, size);
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const light = new THREE.DirectionalLight(0xffffff, 0.7);
    light.position.set(2, 4, 3);
    scene.add(light);

    const group = new THREE.Group();
    scene.add(group);
    let disposed = false;

    function frameCamera(box) {
      const size3 = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size3.x, size3.y, size3.z) || 1;
      camera.position.set(0, 0, maxDim * 2.4);
      camera.lookAt(0, 0, 0);
    }

    if (isStl) {
      const loader = new STLLoader();
      loader.load(modelFile, (geometry) => {
        if (disposed) return;
        geometry.center();
        const material = new THREE.MeshStandardMaterial({ color: stlColor, roughness: 0.6 });
        const mesh = new THREE.Mesh(geometry, material);
        group.add(mesh);
        geometry.computeBoundingBox();
        frameCamera(geometry.boundingBox);
      });
    } else {
      const loader = new GLTFLoader();
      loader.load(modelFile, (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        group.add(model);
        frameCamera(box);

        if (accessoryFile) {
          loader.load(accessoryFile, (acc) => {
            if (disposed) return;
            const accModel = acc.scene;
            accModel.position.set(0, box.max.y - center.y - 0.05, 0.05);
            accModel.scale.setScalar(0.9);
            group.add(accModel);
          });
        }
      });
    }

    let raf;
    function animate() {
      raf = requestAnimationFrame(animate);
      group.rotation.y += 0.008;
      renderer.render(scene, camera);
    }
    animate();

    let dragging = false;
    let lastX = 0;
    function onDown(e) { dragging = true; lastX = e.clientX; }
    function onUp() { dragging = false; }
    function onMove(e) {
      if (!dragging) return;
      group.rotation.y += (e.clientX - lastX) * 0.01;
      lastX = e.clientX;
    }
    renderer.domElement.style.cursor = "grab";
    renderer.domElement.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointermove", onMove);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointermove", onMove);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, [modelFile, accessoryFile, size]);

  if (!modelFile) return null;
  return <div ref={mountRef} style={{ width: size, height: size, margin: "0 auto" }} />;
}
