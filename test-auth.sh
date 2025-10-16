#!/bin/bash

# Script para probar la autenticación del backend
# Uso: ./test-auth.sh <FIREBASE_TOKEN>

echo "🧪 Probando autenticación del backend..."
echo ""

# Verificar que se proporcionó un token
if [ -z "$1" ]; then
  echo "❌ Error: Debes proporcionar un token de Firebase"
  echo "Uso: ./test-auth.sh <FIREBASE_TOKEN>"
  echo ""
  echo "Para obtener un token:"
  echo "1. Inicia sesión en la app móvil"
  echo "2. Agrega este código temporal:"
  echo "   final token = await FirebaseAuth.instance.currentUser?.getIdToken();"
  echo "   print('Token: \$token');"
  exit 1
fi

TOKEN=$1
BASE_URL="http://localhost:3000"

echo "📍 URL: $BASE_URL"
echo "🔑 Token: ${TOKEN:0:20}..."
echo ""

# Test 1: Health check (sin autenticación)
echo "Test 1: Health Check (sin autenticación)"
echo "----------------------------------------"
curl -s "$BASE_URL/health" | jq '.'
echo ""
echo ""

# Test 2: Auth test endpoint
echo "Test 2: Auth Test Endpoint"
echo "----------------------------------------"
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/auth/test")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo "HTTP Status: $HTTP_CODE"
echo "Response:"
echo "$BODY" | jq '.'
echo ""

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Autenticación exitosa!"
else
  echo "❌ Autenticación fallida"
  echo ""
  echo "Posibles causas:"
  echo "1. Token expirado (obtén uno nuevo)"
  echo "2. Firebase Admin no configurado correctamente"
  echo "3. Credenciales incorrectas en .env"
fi
echo ""

# Test 3: Scoring endpoint (requiere autenticación)
echo "Test 3: Scoring Endpoint"
echo "----------------------------------------"
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"microfinancieraId":"mf001","applicationId":"test123"}' \
  "$BASE_URL/api/scoring/calculate")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo "HTTP Status: $HTTP_CODE"
echo "Response:"
echo "$BODY" | jq '.'
echo ""

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Endpoint de scoring funciona!"
elif [ "$HTTP_CODE" = "401" ]; then
  echo "❌ Error de autenticación en endpoint de scoring"
else
  echo "⚠️  Otro error (puede ser normal si no existe la aplicación)"
fi
