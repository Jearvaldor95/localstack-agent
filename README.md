# localstack-agent

Agente que escanea el código fuente de un proyecto, detecta qué servicios AWS utiliza y crea automáticamente los recursos correspondientes en [LocalStack](https://localstack.cloud/).

Puede usarse como **CLI**, como **script Node.js** o como **servidor MCP** (Model Context Protocol) para integrarse con asistentes de IA como Kiro.

---

## Servicios soportados

| Servicio   | Recursos que crea          |
|------------|----------------------------|
| DynamoDB   | Tablas (con PK, SK y GSIs) |
| SQS        | Colas                      |
| S3         | Buckets                    |
| SNS        | Topics                     |
| IAM        | Roles                      |

---

## Requisitos previos

- [Node.js](https://nodejs.org/) v18 o superior
- [LocalStack](https://localstack.cloud/) corriendo localmente (por defecto en `http://localhost:4566`)
- Docker (para correr LocalStack)

### Iniciar LocalStack

```bash
# Con Docker
docker run --rm -p 4566:4566 localstack/localstack

# Con Podman
podman run --rm -p 4566:4566 localstack/localstack

# O con localstack CLI
localstack start
```

> También es compatible con **MiniStack** o cualquier emulador que exponga la API de LocalStack. Si usa un puerto distinto al `4566`, ajusta la variable de entorno:
> ```bash
> LOCALSTACK_ENDPOINT=http://localhost:PUERTO localstack-agent
> ```

---

## Instalación

### Desde npm (global)

```bash
npm install -g localstack-agent
```

### Sin instalación (npx)

```bash
# Escanear el directorio actual
npx localstack-agent

# Escanear un proyecto específico
npx localstack-agent /ruta/al/proyecto
```

### Local (clonar el repositorio)

```bash
git clone <repo-url>
cd localstack-agent
npm install
```

---

## Uso

### Como CLI

```bash
# Escanear el directorio actual
localstack-agent

# Escanear un proyecto específico
localstack-agent /ruta/al/proyecto
```

### Como servidor MCP

```bash
localstack-agent-mcp
```

El servidor MCP expone la herramienta `provision_localstack` que acepta un `projectPath` y devuelve el log de los recursos creados.

#### Configuración en Kiro (`~/.kiro/settings/mcp.json`)

```json
{
  "mcpServers": {
    "localstack-agent": {
      "command": "npx",
      "args": ["localstack-agent-mcp"]
    }
  }
}
```

---

## Cómo funciona

### 1. Detección (`src/detector.js`)

Escanea los archivos de código fuente (`.js`, `.ts`, `.java`, `.py`, `.go`, `.cs`, `.rb`) buscando patrones de importación de los SDKs de AWS:

- Prioriza archivos modificados según `git diff` (archivos staged, unstaged y untracked).
- Si no hay repositorio git, hace un walk completo del directorio ignorando `node_modules`, `.git`, `dist`, `build` y `coverage`.

### 2. Parseo de configuración (`src/parser.js`)

Busca un archivo `application.yaml` o `application.yml` en el proyecto y extrae los nombres de recursos:

| Sección YAML              | Criterio                                      | Recurso        |
|---------------------------|-----------------------------------------------|----------------|
| `aws.dynamodb.*`          | Todos los valores (excepto `endpoint`)        | Tabla DynamoDB |
| `aws.sqs.*`               | Todos los valores (excepto `endpoint`)        | Cola SQS       |
| `aws.s3.*-bucket-name` / `aws.s3.*.bucket` | Claves que terminen en `bucket-name` o `bucket` | Bucket S3 |
| `topic-name`, `topic-arn` | Claves con ese nombre en cualquier nivel      | Topic SNS      |
| `role-name`, `rolename`   | Claves con ese nombre en cualquier nivel      | Rol IAM        |

Resuelve placeholders de Spring Boot (`${VAR:default}` → `default`) y descarta URLs, ARNs y rutas.

Para DynamoDB, asocia cada tabla a su esquema correcto siguiendo dos estrategias:

**Patrón entidad (`@DynamoDbBean`):**
1. Escanea clases `@DynamoDbBean` y extrae PK, SK y GSIs usando `@DynamoDbAttribute`
2. Escanea repositories que inyectan el nombre de tabla via `@Value("${aws.dynamodb.X}")` y referencian la entidad en el generic (`extends TemplateAdapterOperations<..., MiEntidadDynamoEntity>`)
3. Construye un mapa `tableName → schema` para que cada tabla se cree con su propio esquema

**Patrón SDK directo (sin `@DynamoDbBean`):**
1. Detecta repositories con `@Value("${aws.dynamodb.X}")` que construyen la key manualmente (e.g. `Map.of(FIELD, ...)`)
2. Resuelve la constante `String` usada como clave para inferir el PK
3. Usa ese PK si no se encontró un esquema por el patrón de entidad

### 3. Provisionamiento (`src/provisioner.js`)

Crea los recursos en LocalStack usando los AWS SDKs v3. Si un recurso ya existe, lo omite sin error. Si no se encontró configuración YAML, usa nombres por defecto (`default-table`, `default-queue`, etc.).

---

## Variables de entorno

| Variable               | Valor por defecto         | Descripción                        |
|------------------------|---------------------------|------------------------------------|
| `LOCALSTACK_ENDPOINT`  | `http://localhost:4566`   | URL del endpoint de LocalStack     |
| `AWS_DEFAULT_REGION`   | `us-east-1`               | Región AWS a usar                  |

---

## Ejemplo de `application.yaml`

```yaml
aws:
  dynamodb:
    endpoint: "${AWS_DYNAMO_ENDPOINT:http://localhost:4566}"
    orders: "${DYNAMO_TABLE_ORDERS_NAME:orders-table-local}"
    users: "${DYNAMO_TABLE_USERS_NAME:users-table-local}"
  sqs:
    endpoint: "${AWS_SQS_ENDPOINT:http://localhost:4566}"
    orders-queue: "${SQS_ORDERS_QUEUE:orders-queue-local}"
  s3:
    files-bucket-name: "${AWS_S3_FILES_BUCKET_NAME:files-bucket-local}"
    assets-bucket-name: "${AWS_S3_ASSETS_BUCKET_NAME:assets-bucket-local}"
```

Con este archivo el agente creará las tablas `orders-table-local` y `users-table-local`, la cola `orders-queue-local` y los buckets `files-bucket-local` y `assets-bucket-local` en LocalStack, cada tabla con el esquema (PK/SK/GSIs) de su entidad `@DynamoDbBean` correspondiente.

---

## Estructura del proyecto

```
localstack-agent/
├── src/
│   ├── agent.js        # Orquestador principal (CLI)
│   ├── detector.js     # Detección de servicios AWS en el código
│   ├── parser.js       # Parseo de application.yaml y esquemas DynamoDB
│   └── provisioner.js  # Creación de recursos en LocalStack
├── mcp-server.js       # Servidor MCP (integración con IA)
└── package.json
```
