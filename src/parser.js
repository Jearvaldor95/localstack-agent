const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', 'target', 'coverage', '.idea'];

function findYaml(rootDir = process.cwd()) {
  const queue = [rootDir];
  while (queue.length) {
    const dir = queue.shift();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.includes(entry.name)) queue.push(path.join(dir, entry.name));
      } else if (/^application\.(ya?ml)$/.test(entry.name)) {
        return path.join(dir, entry.name);
      }
    }
  }
  return null;
}

function flattenKeys(obj, prefix = '', result = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenKeys(v, key, result);
    else result[key] = v;
  }
  return result;
}

// Resuelve ${VAR:default} → default
function resolveSpring(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{[^}]*?:([^}]+)\}/g, '$1').replace(/\$\{[^}]+\}/g, '');
}

// Descarta URLs, ARNs, rutas — solo acepta nombres simples
function isResourceName(v) {
  if (!v || typeof v !== 'string') return false;
  const t = v.trim();
  return t.length > 0
    && !/^https?:\/\//i.test(t)
    && !/^arn:/i.test(t)
    && !/[/\\]/.test(t)
    && !/^\d+\.\d+/.test(t);
}

function extractNames(flat, keyPattern) {
  return Object.entries(flat)
    .filter(([k]) => keyPattern.test(k))
    .map(([, v]) => resolveSpring(v))
    .filter(isResourceName);
}

// Extrae nombre del atributo: @DynamoDbAttribute("x") → "x", sino usa el nombre del getter
function resolveAttrName(annotations, fieldName) {
  const m = annotations.match(/@DynamoDbAttribute\s*\(\s*["']([^"']+)["']\s*\)/);
  return m ? m[1] : fieldName.charAt(0).toLowerCase() + fieldName.slice(1);
}

// Retorna array de schemas únicos (deduplicados por pk+sk), uno por cada @DynamoDbBean
function scanDynamoSchemas(rootDir) {
  const schemas = [];
  const seen = new Set();
  const queue = [rootDir];

  while (queue.length) {
    const dir = queue.shift();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.includes(entry.name)) queue.push(path.join(dir, entry.name));
        continue;
      }
      if (!entry.name.endsWith('.java')) continue;

      const content = fs.readFileSync(path.join(dir, entry.name), 'utf8');
      if (!/@DynamoDbBean/.test(content)) continue;

      const schema = { gsis: [] };
      for (const [, annotations, , fieldName] of content.matchAll(/((?:@\w+[^)]*\)\s*)*)(public\s+\w+\s+get(\w+)\(\))/g)) {
        const attr = resolveAttrName(annotations, fieldName);
        if (/@DynamoDbPartitionKey\b/.test(annotations) && !/@DynamoDbSecondary/.test(annotations)) {
          schema.pk = attr;
        } else if (/@DynamoDbSortKey\b/.test(annotations) && !/@DynamoDbSecondary/.test(annotations)) {
          schema.sk = attr;
        } else if (/@DynamoDbSecondaryPartitionKey/.test(annotations)) {
          const m = annotations.match(/indexNames\s*=\s*["']([^"']+)["']/);
          if (m) {
            let gsi = schema.gsis.find(g => g.name === m[1]) || { name: m[1] };
            if (!schema.gsis.find(g => g.name === m[1])) schema.gsis.push(gsi);
            gsi.pk = attr;
          }
        } else if (/@DynamoDbSecondarySortKey/.test(annotations)) {
          const m = annotations.match(/indexNames\s*=\s*["']([^"']+)["']/);
          if (m) {
            let gsi = schema.gsis.find(g => g.name === m[1]) || { name: m[1] };
            if (!schema.gsis.find(g => g.name === m[1])) schema.gsis.push(gsi);
            gsi.sk = attr;
          }
        }
      }
      if (schema.pk) {
        const key = `${schema.pk}|${schema.sk || ''}`;
        if (!seen.has(key)) { seen.add(key); schemas.push(schema); }
      }
    }
  }
  return schemas;
}

function parse(rootDir = process.cwd()) {
  const yamlPath = findYaml(rootDir);
  if (!yamlPath) return { resources: {}, yamlPath: null };

  const raw = yaml.load(fs.readFileSync(yamlPath, 'utf8')) || {};
  const flat = flattenKeys(raw);
  const resources = {};

  // Captura todos los valores bajo aws.dynamodb.* excepto endpoint
  const tables = Object.entries(flat)
    .filter(([k]) => /^aws\.dynamodb\./i.test(k) && !/endpoint$/i.test(k))
    .map(([, v]) => resolveSpring(v))
    .filter(isResourceName);

  // Captura todos los valores bajo aws.sqs.* excepto endpoint
  const queues = Object.entries(flat)
    .filter(([k]) => /^aws\.sqs\./i.test(k) && !/endpoint$/i.test(k))
    .map(([, v]) => resolveSpring(v))
    .filter(isResourceName);

  // Captura todos los valores bajo aws.s3.* que terminen en bucket-name
  const buckets = Object.entries(flat)
    .filter(([k]) => /^aws\.s3\./i.test(k) && /bucket-name$/i.test(k))
    .map(([, v]) => resolveSpring(v))
    .filter(isResourceName);

  const topics  = extractNames(flat, /topic-name|topicname|topic-arn/i);
  const roles   = extractNames(flat, /role-name|rolename/i);

  if (tables.length) {
    const schemas = scanDynamoSchemas(rootDir);
    // schemas[0] es el fallback si solo hay un esquema; provisioner usará el índice por tabla
    resources.dynamodb = { tables, schemas };
  }
  if (queues.length)  resources.sqs = { queues };
  if (buckets.length) resources.s3  = { buckets };
  if (topics.length)  resources.sns = { topics };
  if (roles.length)   resources.iam = { roles };

  return { resources, yamlPath };
}

module.exports = { parse };
