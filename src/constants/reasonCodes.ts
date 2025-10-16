export const REASON_CODES = {
  // Códigos positivos (RC01-RC05)
  RC01: "Ingreso mensual alto y estable",
  RC02: "Baja relación deuda/ingreso",
  RC03: "Antigüedad laboral significativa",
  RC04: "Empleo formal con contrato indefinido",
  RC05: "Historial crediticio positivo",

  // Códigos de advertencia (RC06-RC10)
  RC06: "Ingreso mensual justo para el monto solicitado",
  RC07: "Relación deuda/ingreso moderada",
  RC08: "Antigüedad laboral limitada",
  RC09: "Empleo independiente o temporal",
  RC10: "Sin historial crediticio verificable",

  // Códigos negativos (RC11-RC15)
  RC11: "Ingreso mensual insuficiente",
  RC12: "Relación deuda/ingreso muy alta",
  RC13: "Antigüedad laboral insuficiente",
  RC14: "Situación laboral inestable",
  RC15: "Historial crediticio negativo o dudoso",

  // Códigos de validación (RC16-RC20)
  RC16: "Monto solicitado fuera de rango permitido",
  RC17: "Plazo solicitado fuera de rango permitido",
  RC18: "Edad del solicitante no cumple requisitos",
  RC19: "Cuota mensual excede capacidad de pago",
  RC20: "Documentación incompleta o inválida",
};

export type ReasonCode = keyof typeof REASON_CODES;

export function getReasonCodeDescription(code: ReasonCode): string {
  return REASON_CODES[code] || "Código desconocido";
}

