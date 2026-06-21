#!/bin/bash

# CMG Telematics - Setup Multi-Agente
# Script de configuración inicial

set -e  # Exit on any error

echo "🚀 Configurando CMG Telematics Multi-Agent Environment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Verificar dependencias
check_dependencies() {
    echo -e "${YELLOW}📋 Verificando dependencias...${NC}"
    
    # Git
    if ! command -v git &> /dev/null; then
        echo -e "${RED}❌ Git no instalado${NC}"
        exit 1
    fi
    
    # Docker
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}❌ Docker no instalado${NC}"
        exit 1
    fi
    
    # Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        echo -e "${RED}❌ Docker Compose no instalado${NC}"
        exit 1
    fi
    
    # Python 3.11+
    if ! command -v python3 &> /dev/null; then
        echo -e "${RED}❌ Python 3 no instalado${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Dependencias verificadas${NC}"
}

# Crear estructura de directorios
create_structure() {
    echo -e "${YELLOW}📁 Creando estructura de proyecto...${NC}"
    
    # Crear directorios base
    mkdir -p {agents/{architect,backend,security,qa,database,frontend},backend/{app,tests},docs,infrastructure/{docker,nginx,github-actions},frontend/src,tests/{unit,integration,e2e},scripts,monitoring}
    
    # Crear archivos base
    touch backend/requirements.txt
    touch backend/app/__init__.py
    touch backend/app/main.py
    touch docs/README.md
    touch .env.example
    touch .gitignore
    
    echo -e "${GREEN}✅ Estructura creada${NC}"
}

# Configurar Git y archivos base
setup_git() {
    echo -e "${YELLOW}🔧 Configurando Git...${NC}"
    
    # Inicializar repositorio si no existe
    if [ ! -d .git ]; then
        git init
        git branch -m main
    fi
    
    # Crear .gitignore completo
    cat > .gitignore << 'EOF'
# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
build/
develop-eggs/
dist/
downloads/
eggs/
.eggs/
lib/
lib64/
parts/
sdist/
var/
wheels/
*.egg-info/
.installed.cfg
*.egg

# Virtual environments
.env
.venv
env/
venv/
ENV/
env.bak/
venv.bak/

# IDEs
.vscode/
.idea/
*.swp
*.swo
*~

# Testing
.coverage
htmlcov/
.pytest_cache/
.cache
nosetests.xml
coverage.xml
*.cover
.hypothesis/

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Dependencies
node_modules/
npm-debug.log*

# Build outputs
frontend/build/
frontend/dist/

# Docker
.dockerignore

# Secrets
.env.local
.env.production
secrets/
*.pem
*.key

# Database
*.db
*.sqlite3

# OS
.DS_Store
Thumbs.db
EOF

    echo -e "${GREEN}✅ Git configurado${NC}"
}

# Crear configuración Docker base
setup_docker() {
    echo -e "${YELLOW}🐳 Configurando Docker...${NC}"
    
    # Dockerfile para backend
    cat > infrastructure/docker/Dockerfile.backend << 'EOF'
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/ .

# Create non-root user
RUN adduser --disabled-password --gecos '' appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
EOF

    # Docker Compose para desarrollo
    cat > infrastructure/docker/docker-compose.dev.yml << 'EOF'
version: '3.8'

services:
  db:
    image: timescale/timescaledb:latest-pg15
    environment:
      POSTGRES_DB: cmg_telematics
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  backend:
    build:
      context: ../../
      dockerfile: infrastructure/docker/Dockerfile.backend
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@db:5432/cmg_telematics
      REDIS_URL: redis://redis:6379
    depends_on:
      - db
      - redis
    volumes:
      - ../../backend:/app
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

volumes:
  postgres_data:
EOF

    echo -e "${GREEN}✅ Docker configurado${NC}"
}

# Configurar requirements.txt básico
setup_python() {
    echo -e "${YELLOW}🐍 Configurando Python environment...${NC}"
    
    cat > backend/requirements.txt << 'EOF'
# FastAPI core
fastapi==0.104.1
uvicorn[standard]==0.24.0
pydantic==2.5.0

# Database
sqlalchemy==2.0.23
asyncpg==0.29.0
alembic==1.12.1

# Authentication & Security
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
python-multipart==0.0.6

# Cache & Jobs
redis==5.0.1
celery==5.3.4

# HTTP client
httpx==0.25.2

# Testing
pytest==7.4.3
pytest-asyncio==0.21.1
pytest-cov==4.1.0
httpx==0.25.2

# Development
python-dotenv==1.0.0
isort==5.12.0
black==23.11.0
flake8==6.1.0

# Monitoring
sentry-sdk[fastapi]==1.38.0

# Data processing
pandas==2.1.3
numpy==1.25.2
EOF

    echo -e "${GREEN}✅ Python requirements configurado${NC}"
}

# Crear configuración inicial de CI/CD
setup_cicd() {
    echo -e "${YELLOW}🔄 Configurando CI/CD...${NC}"
    
    mkdir -p .github/workflows
    
    cat > .github/workflows/test.yml << 'EOF'
name: Tests

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main, develop ]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: timescale/timescaledb:latest-pg15
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: test_db
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
    - uses: actions/checkout@v3
    
    - name: Set up Python
      uses: actions/setup-python@v4
      with:
        python-version: '3.11'
        
    - name: Install dependencies
      run: |
        python -m pip install --upgrade pip
        pip install -r backend/requirements.txt
        
    - name: Run tests
      run: |
        cd backend
        pytest --cov=app --cov-report=xml
        
    - name: Upload coverage
      uses: codecov/codecov-action@v3
      with:
        file: ./backend/coverage.xml
EOF

    echo -e "${GREEN}✅ CI/CD configurado${NC}"
}

# Crear README principal
create_readme() {
    echo -e "${YELLOW}📖 Creando documentación...${NC}"
    
    cat > README.md << 'EOF'
# CMG Telematics - Multi-Agent Architecture

Plataforma SaaS de telemetría industrial avanzada para vehículos especializados (aspirado, cisterna, barrido).

## 🏗️ Arquitectura Multi-Agente

El proyecto está desarrollado por un equipo de agentes especializados:

- **🏛️ Arquitecto Senior**: Coordinación y decisiones técnicas
- **🔧 Backend Specialist**: APIs, lógica de negocio, integración Teltonika  
- **🔒 Security/DevOps**: Seguridad, infraestructura, monitorización
- **🧪 QA Engineer**: Testing automatizado, calidad de código
- **🗄️ Database Specialist**: TimescaleDB, optimización, migraciones
- **🎨 Frontend Specialist**: React, dashboards, UX/UI

## 🚀 Tech Stack

### Backend
- FastAPI + Python 3.11
- TimescaleDB (PostgreSQL + time-series)
- Redis (cache + message broker)
- Celery (background jobs)

### Frontend
- React + TypeScript
- Next.js
- TailwindCSS + shadcn/ui
- Chart.js para gráficos

### Infrastructure
- Docker + Docker Compose
- GitHub Actions (CI/CD)
- Nginx (reverse proxy)
- Sentry (monitoring)

## 🛠️ Setup de Desarrollo

1. **Clonar y setup inicial**
```bash
git clone <repository>
cd cmg-telematics
./scripts/setup.sh
```

2. **Levantar entorno de desarrollo**
```bash
cd infrastructure/docker
docker-compose -f docker-compose.dev.yml up
```

3. **Acceso a servicios**
- Backend API: http://localhost:8000
- Database: localhost:5432
- Redis: localhost:6379

## 📋 Comandos útiles

```bash
# Tests
cd backend && pytest

# Linting
black . && isort . && flake8 .

# Migraciones
alembic upgrade head

# Logs
docker-compose logs -f backend
```

## 🔒 Seguridad

- Multi-tenant isolation
- JWT + refresh tokens
- Rate limiting
- Input validation
- Audit logging

## 📊 Monitorización

- Uptime: 99.5% SLA
- Performance: p95 < 500ms
- Error rate: < 1%
- Test coverage: >80%

## 🤝 Workflow de Desarrollo

1. Feature request → Arquitecto
2. Task assignment → Agente especializado  
3. Implementation → PR
4. Code review → QA + Security
5. Testing → Automated pipeline
6. Deploy → Production

---

Para más información, ver `docs/` o contactar al equipo de arquitectura.
EOF

    echo -e "${GREEN}✅ README creado${NC}"
}

# Función principal
main() {
    echo -e "${GREEN}🎯 Iniciando setup de CMG Telematics Multi-Agent Environment${NC}"
    
    check_dependencies
    create_structure
    setup_git
    setup_docker
    setup_python
    setup_cicd
    create_readme
    
    echo -e "${GREEN}🎉 Setup completado exitosamente!${NC}"
    echo ""
    echo -e "${YELLOW}📋 Próximos pasos:${NC}"
    echo "1. cd cmg-telematics"
    echo "2. cp .env.example .env (y configurar variables)"
    echo "3. docker-compose -f infrastructure/docker/docker-compose.dev.yml up"
    echo "4. Configurar agentes especializados con prompts específicos"
    echo ""
    echo -e "${GREEN}🚀 ¡Listo para comenzar el desarrollo multi-agente!${NC}"
}

# Ejecutar si el script se llama directamente
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
