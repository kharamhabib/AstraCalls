# Script de Inicialização do AstraCalls
# Inicia tanto o backend Go (com CGO/mlow habilitado) quanto o frontend React em janelas separadas.

# 1. Carrega as variáveis do arquivo .env
Write-Host "Carregando variáveis do arquivo .env..." -ForegroundColor Cyan
if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $index = $line.IndexOf("=")
            if ($index -gt 0) {
                $key = $line.Substring(0, $index).Trim()
                $value = $line.Substring($index + 1).Trim()
                # Remove aspas
                $value = $value -replace "^`"|`"$",""
                $value = $value -replace "^'|'$",""
                if ($key) {
                    [System.Environment]::SetEnvironmentVariable($key, $value, [System.EnvironmentVariableTarget]::Process)
                }
            }
        }
    }
    Write-Host "Variáveis de ambiente do .env carregadas com sucesso!" -ForegroundColor Green
} else {
    Write-Warning "Aviso: Arquivo .env não encontrado no diretório raiz."
}

# 2. Configura as variáveis CGO necessárias para o codec MLow
Write-Host "Configurando ambiente CGO e DLLs..." -ForegroundColor Cyan
$env:CGO_ENABLED = "1"
$env:CGO_LDFLAGS = "-L.\native -lopus_mlow"
$env:PATH = "$pwd\native;" + $env:PATH

# 3. Inicia o Servidor Backend (Go) em uma janela separada
Write-Host "Iniciando o Servidor Backend (Go) na porta 3001..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle = 'AstraCalls Backend'; go run -tags mlow ./cmd/server -addr :3001 -debug" -WorkingDirectory $pwd

# 4. Inicia o Servidor Frontend (Vite) em outra janela separada
Write-Host "Iniciando o Servidor Frontend (Vite) na porta 5173..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle = 'AstraCalls Frontend'; cd client; npm run dev" -WorkingDirectory $pwd

Write-Host "`nPronto! Ambos os serviços foram iniciados em novas janelas do PowerShell." -ForegroundColor Green
Write-Host "• Backend: http://localhost:3001" -ForegroundColor Yellow
Write-Host "• Frontend: http://localhost:5173" -ForegroundColor Yellow
