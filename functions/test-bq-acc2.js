const { BigQuery } = require("@google-cloud/bigquery");

async function main() {
    try {
        const key = require("./usage-key.json");
        const bqClientAcc2 = new BigQuery({ credentials: key, projectId: "emercre-mapsec" });

        console.log("Comprobando conexión a BigQuery (Cuenta 2 - emercre-mapsec)...");
        const [datasets] = await bqClientAcc2.getDatasets();
        const hasBilling = datasets.some(d => d.id === 'billing_export_acc2');
        console.log("Dataset 'billing_export_acc2' encontrado:", hasBilling);

        if (hasBilling) {
            console.log("Buscando tablas en 'billing_export_acc2'...");
            const [tables] = await bqClientAcc2.dataset('billing_export_acc2').getTables();
            
            const table = tables.find(t => t.id.startsWith('gcp_billing_export_v1_'));
            if (table) {
                console.log("¡Tabla de facturación encontrada! ->", table.id);
            } else {
                console.log("Dataset encontrado, pero la tabla 'gcp_billing_export_v1_...' AÚN NO EXISTE (Expected - 24h delay).");
            }
        }
    } catch (e) {
        console.error("❌ ERROR de Permisos o Conexión en la Cuenta 2:");
        console.error(e.message);
    }
}

main();
