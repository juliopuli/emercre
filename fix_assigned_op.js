const fs = require('fs');
let content = fs.readFileSync('index.html', 'utf8');

// The error is using assignedOp before definition in initOystaTracking
// We need to move the assignedOp finding logic up.

const loopStart = 'data.vehicles.forEach(v => {';
const searchPoint = 'const mid = String(v.id);';

const assignedOpLogic = `
          // V.12.3.0: Determinar si el vehículo está asignado a una operación activa
          let assignedOp = null;
          if (localVehiclesByOystaId[String(v.id)] && typeof ops !== 'undefined') {
            const lVeh = localVehiclesByOystaId[String(v.id)];
            assignedOp = Object.values(ops).find(op => 
              op.estado === 'activa' && 
              op.recursosAsignadosIds && 
              op.recursosAsignadosIds.includes(lVeh.id)
            );
          }
`;

content = content.replace(searchPoint, assignedOpLogic + '          ' + searchPoint);

// Also remove the "const" from the later definition to avoid double declaration if it's in the same scope,
// but actually it's inside another if block later.
// Let's change the later "const assignedOp =" to just "if (assignedOp) {" logic or similar.

content = content.replace(
    /if \(localVeh && ops\) \{\n\s*\/\/ Buscamos si este vehículo está asignado a alguna operación abierta\n\s*const assignedOp = Object\.values\(ops\)\.find\(op =>/,
    'if (localVeh && ops && assignedOp) {\n            // Ya tenemos assignedOp arriba\n            const _dummy = Object.values(ops).find(op =>'
);

// Actually, better to just refactor the second part to use the variable we already have.
content = content.replace(
    /const assignedOp = Object\.values\(ops\)\.find\(op =>\n\s*op\.estado === 'activa' &&\n\s*op\.recursosAsignadosIds &&\n\s*op\.recursosAsignadosIds\.includes\(localVeh\.id\)\n\s*\);/,
    ''
);
// And ensure the following 'if (assignedOp)' works.

fs.writeFileSync('index.html', content);
console.log("AssignedOp logic fixed.");
