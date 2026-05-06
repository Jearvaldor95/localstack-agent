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

# O con localstack CLI
localstack start
```

---

## Instalación

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
node src/agent.js

# Escanear un proyecto específico
node src/agent.js /ruta/al/proyecto
```

### Como servidor MCP

```bash
node mcp-server.js
```

El servidor MCP expone la herramienta `provision_localstack` que acepta un `projectPath` y devuelve el log de los recursos creados.

#### Configuración en Kiro (`~/.kiro/settings/mcp.json`)

```json
{
  "mcpServers": {
    "localstack-agent": {
      "command": "node",
      "args": ["C:/Users/Usuario/localstack-agent/mcp-server.js"]
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
| `aws.s3.*-bucket-name`    | Claves que terminen en `bucket-name`          | Bucket S3      |
| `topic-name`, `topic-arn` | Claves con ese nombre en cualquier nivel      | Topic SNS      |
| `role-name`, `rolename`   | Claves con ese nombre en cualquier nivel      | Rol IAM        |

Resuelve placeholders de Spring Boot (`${VAR:default}` → `default`) y descarta URLs, ARNs y rutas.

Para DynamoDB, también escanea clases Java anotadas con `@DynamoDbBean` para extraer automáticamente la PK, SK y GSIs del esquema.

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
    table-name: usuarios
  sqs:
    queue-name: pedidos-queue
  s3:
    bucket-name: archivos-app
  sns:
    topic-name: notificaciones
```

Con este archivo, el agente creará la tabla `usuarios`, la cola `pedidos-queue`, el bucket `archivos-app` y el topic `notificaciones` en LocalStack.

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
