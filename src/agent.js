#!/usr/bin/env node
const path = require('path');
const { detect } = require('./detector');
const { parse }  = require('./parser');
const { provision } = require('./provisioner');


async function run(projectPath) {
  const rootDir = path.resolve(projectPath || process.cwd());
  const log = [];
  const out = (msg) => { console.error(msg); log.push(msg); };

  out(`🔍 Escaneando código en: ${rootDir}`);

  const services = detect(rootDir);
  if (!services.length) {
    out('✅ No se encontró uso de servicios AWS en el código.');
    return { success: true, services: [], log };
  }
  out(`📦 Servicios detectados: ${services.join(', ')}`);

  const { resources, yamlPath } = parse(rootDir);
  out(yamlPath
    ? `📄 Configuración leída desde: ${yamlPath}`
    : '⚠️  No se encontró application.yaml — se usarán nombres por defecto');

  out('🚀 Creando recursos en LocalStack...');
  await provision(services, resources);
  out('✅ Todos los recursos fueron provisionados.');

  return { success: true, services, resources, log };
}

module.exports = { run };

// Ejecución directa: node agent.js [path]
if (require.main === module) {
  run(process.argv[2]).catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
}
