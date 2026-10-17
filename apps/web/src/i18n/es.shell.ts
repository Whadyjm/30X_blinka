/** Spanish: shell, landing, login, home, onboarding, navigation, route guards. */
export const esShell: Record<string, string> = {
  // not found / coming soon
  'This page doesn’t exist': 'Esta página no existe',
  'Back home': 'Volver al inicio',
  'Not built yet': 'Aún no está construido',
  'This is a P1 feature. It stays hidden until the core invoice flow is solid.': 'Esta es una función P1. Permanece oculta hasta que el flujo central de facturas esté sólido.',
  'Agent access': 'Acceso de agentes',
  'Chat with Oli': 'Chatea con Oli',

  // navigation
  Home: 'Inicio',
  Chat: 'Chat',
  Main: 'Principal',
  '{n} pending': '{n} pendientes',
  'Sign out': 'Cerrar sesión',
  'Open menu': 'Abrir menú',
  'Close menu': 'Cerrar menú',
  owner: 'propietario',
  approver: 'aprobador',

  // demo banner
  'Mock API — no backend connected': 'API simulada: sin backend conectado',
  'Reset demo data': 'Restablecer datos de demostración',
  'Preview onboarding': 'Ver el onboarding',

  // guards
  'Signing you in': 'Iniciando tu sesión',
  'Can’t reach Oli': 'No se puede conectar con Oli',
  'Waiting for the owner': 'Esperando al propietario',
  'Rules haven’t been activated for this organization yet. An owner needs to finish setup first.':
    'Las reglas aún no se han activado en esta organización. Un propietario debe terminar primero la configuración.',

  // login
  'Enter the demo organization': 'Demo de organización',
  'A fictitious company with sample invoices. No sign-up needed.': 'Una empresa ficticia con facturas de ejemplo. No necesitas registrarte.',
  'or sign in': 'o inicia sesión',
  Email: 'Correo electrónico',
  Password: 'Contraseña',
  'Sign in': 'Iniciar sesión',
  'Mock mode credentials:': 'Credenciales del modo simulado:',

  // landing
  'Open app': 'Abrir la app',
  'Give Oli your invoices and tell it what it may approve. It reviews each one against your rules and only interrupts you when it truly needs permission.':
    'Entrégale tus facturas a Oli y dile qué puede aprobar. Revisa cada una según tus reglas y solo te interrumpe cuando de verdad necesita permiso.',
  'See how it decides': 'Mira cómo decide',
  'Fictitious companies and documents. No real money moves.': 'Empresas y documentos ficticios. No se mueve dinero real.',
  'Possible outcomes': 'Resultados posibles',
  'Authorized vendor, matches the agreement, inside your limits, budget available. Approved for simulated payment.':
    'Proveedor autorizado, coincide con el acuerdo, dentro de tus límites y con presupuesto disponible. Aprobada para pago simulado.',
  'A real exception — like an amount above the automatic limit. Oli asks you and re-checks everything before confirming.':
    'Una excepción real, como un monto por encima del límite automático. Oli te consulta y vuelve a verificar todo antes de confirmar.',
  'Duplicate, unauthorized vendor, over the ceiling or out of budget. A “yes” can’t override these.':
    'Duplicada, proveedor no autorizado, sobre el techo o sin presupuesto. Un “sí” no puede anular estos casos.',
  'The idea': 'La idea',
  '{name} is a hackathon prototype. “Approved” means approved for a simulated payment — no transfers, bank connections or KYC.':
    '{name} es un prototipo de hackatón. “Aprobada” significa aprobada para un pago simulado: sin transferencias, conexiones bancarias ni KYC.',

  // home
  'Hi {name}': 'Hola, {name}',
  'Hi there': 'Hola',
  Summary: 'Resumen',
  'Approved (simulated)': 'Aprobadas (simulado)',
  'Needs you': 'Te necesitan',
  'Due in 14 days': 'Vencen en 14 días',
  'Recent activity': 'Actividad reciente',
  'View all': 'Ver todas',
  'Upload your first invoice and Oli will review it against your rules.': 'Sube tu primera factura y Oli la revisará según tus reglas.',
  '{name}’s briefing': 'Resumen de {name}',
  'Budget · {period}': 'Presupuesto · {period}',
  '{n}% reserved': '{n}% reservado',
  'Budget reserved': 'Presupuesto reservado',
  '{left} left of {total}': 'Quedan {left} de {total}',
  'Coming due': 'Próximos vencimientos',
  'Nothing due in the next two weeks.': 'Nada vence en las próximas dos semanas.',
  '{label}: no transfer is made. Demo data is fictitious.': '{label}: no se realiza ninguna transferencia. Los datos de demostración son ficticios.',

  // onboarding
  'Your mandate': 'Tu mandato',
  'Who can be paid': 'A quién se puede pagar',
  'Review & activate': 'Revisar y activar',
  'Oli is ready. Upload your first invoice.': 'Oli está listo. Sube tu primera factura.',
  'Step {n} of {total}': 'Paso {n} de {total}',
  'Setup progress': 'Progreso de la configuración',
  'Tell Oli about your (fictitious) company. Use made-up names — this is a demo.': 'Cuéntale a Oli sobre tu empresa (ficticia). Usa nombres inventados: esto es una demostración.',
  'Company name': 'Nombre de la empresa',
  'e.g. Northwind Demo Co.': 'p. ej. Northwind Demo Co.',
  'Default currency': 'Moneda predeterminada',
  'Budgets are kept per currency; Oli never mixes them.': 'Los presupuestos se llevan por moneda; Oli nunca las mezcla.',
  'Your name': 'Tu nombre',
  'Who is responsible for approvals?': '¿Quién es responsable de las aprobaciones?',
  'What may Oli approve on its own, and when should it ask you?': '¿Qué puede aprobar Oli por sí solo y cuándo debe consultarte?',
  'Authorized vendors and what they normally charge. You can change this any time.': 'Proveedores autorizados y lo que cobran normalmente. Puedes cambiarlo en cualquier momento.',
  'With no authorized vendors, Oli will block every invoice. Add at least one or load the sample set.':
    'Sin proveedores autorizados, Oli bloqueará todas las facturas. Agrega al menos uno o carga el conjunto de ejemplo.',
  'These are the exact rules Oli will follow. Nothing is active until you confirm.': 'Estas son las reglas exactas que seguirá Oli. Nada se activa hasta que confirmes.',
  '1 authorized vendor · {a} active agreements': '1 proveedor autorizado · {a} acuerdos activos',
  '{v} authorized vendors · {a} active agreements': '{v} proveedores autorizados · {a} acuerdos activos',
  'I confirm these rules.': 'Confirmo estas reglas.',
  'This creates policy version 1. You can change it later; old versions are kept for the audit trail.':
    'Esto crea la versión 1 de la política. Puedes cambiarla después; las versiones anteriores se conservan para la auditoría.',
  Back: 'Atrás',
  Continue: 'Continuar',
  'Activate Oli': 'Activar a Oli',
};
