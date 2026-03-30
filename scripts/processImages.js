const Jimp = require('jimp');

async function processImage(inputPath, outputPath) {
  try {
    console.log("Reading " + inputPath);
    const image = await Jimp.read(inputPath);
    
    // Scale down to ~150px to fit properly as an icon
    image.resize(Jimp.AUTO, 150);
    
    const width = image.bitmap.width;
    const height = image.bitmap.height;
    
    const bg_r = image.bitmap.data[0];
    const bg_g = image.bitmap.data[1];
    const bg_b = image.bitmap.data[2];
    const tolerance = 60; // Max color distance for edge matching

    const visited = new Uint8Array(width * height);
    const queue = [];

    // Push all borders to queue for flood fill
    for (let x = 0; x < width; x++) { queue.push([x, 0]); visited[x] = 1; }
    for (let x = 0; x < width; x++) { queue.push([x, height-1]); visited[(height-1)*width + x] = 1; }
    for (let y = 0; y < height; y++) { queue.push([0, y]); visited[y*width] = 1; }
    for (let y = 0; y < height; y++) { queue.push([width-1, y]); visited[y*width + width - 1] = 1; }

    let head = 0;
    while(head < queue.length) {
      const [x, y] = queue[head++];
      
      const idx = (width * y + x) << 2;
      const r = image.bitmap.data[idx + 0];
      const g = image.bitmap.data[idx + 1];
      const b = image.bitmap.data[idx + 2];
      
      const dist = Math.abs(r - bg_r) + Math.abs(g - bg_g) + Math.abs(b - bg_b);
      
      if (dist < tolerance) {
        // match, make background transparent
        image.bitmap.data[idx + 3] = 0; 
        
        // scan neighbors
        const neighbors = [[x+1, y], [x-1, y], [x, y+1], [x, y-1]];
        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nIdx = ny * width + nx;
            if (!visited[nIdx]) {
              visited[nIdx] = 1;
              queue.push([nx, ny]);
            }
          }
        }
      }
    }

    await image.writeAsync(outputPath);
    console.log("Transformed successfully: " + outputPath);
  } catch (err) {
    console.error("Error processing " + inputPath + ":", err);
  }
}

async function main() {
    await processImage('/home/julio/.gemini/antigravity/brain/4dab93e3-dff6-4766-aa60-c7354efc09f4/icon_patrulla_1774882250539.png', '/home/julio/Documentos/Antigravity/EmerCRE/assets/icons/icon_patrulla.png');
    await processImage('/home/julio/.gemini/antigravity/brain/4dab93e3-dff6-4766-aa60-c7354efc09f4/icon_puesto_sanitario_1774882236999.png', '/home/julio/Documentos/Antigravity/EmerCRE/assets/icons/icon_puesto_sanitario.png');
}

main();
