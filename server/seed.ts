import type {
  Category,
  ChatMessage,
  HeatPoint,
  Metrics,
  NotificationEvent,
  Provider,
  Role,
  ServiceRequest,
  UserSession
} from '../src/types';

const now = new Date('2026-04-23T15:30:00.000Z');

const isoFromNow = (hours: number) => new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();

export const categories: Category[] = [
  {
    id: 'cerrajeria',
    name: 'Cerrajeria',
    slug: 'cerrajeria',
    description: 'Aperturas, cambios de chapa, duplicados y emergencias 24/7.',
    image: '/assets/category-cerrajeria.webp',
    accent: '#0d9488',
    averagePrice: 850,
    emergency: true,
    featured: true
  },
  {
    id: 'plomeria',
    name: 'Plomeria',
    slug: 'plomeria',
    description: 'Fugas, instalaciones, tinacos, bombas y mantenimiento preventivo.',
    image: '/assets/category-plomeria.webp',
    accent: '#2563eb',
    averagePrice: 1200,
    emergency: true,
    featured: true
  },
  {
    id: 'cctv',
    name: 'Instalacion CCTV',
    slug: 'cctv',
    description: 'Camaras, cableado, configuracion remota y seguridad residencial.',
    image: '/assets/category-cctv.webp',
    accent: '#7c3aed',
    averagePrice: 4200,
    emergency: false,
    featured: true
  },
  {
    id: 'carpinteria',
    name: 'Carpinteria',
    slug: 'carpinteria',
    description: 'Muebles a medida, puertas, reparaciones y acabados de madera.',
    image: '/assets/category-carpinteria.webp',
    accent: '#b45309',
    averagePrice: 2600,
    emergency: false,
    featured: true
  },
  {
    id: 'albercas',
    name: 'Limpieza de albercas',
    slug: 'albercas',
    description: 'Aspirado, quimicos, bombas, filtros y mantenimiento semanal.',
    image: '/assets/category-albercas.webp',
    accent: '#0891b2',
    averagePrice: 1500,
    emergency: false,
    featured: true
  },
  {
    id: 'jardineria',
    name: 'Jardineria',
    slug: 'jardineria',
    description: 'Poda, diseno de jardines, riego, limpieza y control de plagas.',
    image: '/assets/category-jardineria.webp',
    accent: '#16a34a',
    averagePrice: 980,
    emergency: false,
    featured: false
  },
  {
    id: 'albanileria',
    name: 'Albanileria',
    slug: 'albanileria',
    description: 'Resanes, pisos, muros, impermeabilizacion y obra menor.',
    image: '/assets/category-albanileria.webp',
    accent: '#dc2626',
    averagePrice: 3800,
    emergency: false,
    featured: false
  },
  {
    id: 'climatizacion',
    name: 'Climatizacion',
    slug: 'climatizacion',
    description: 'Instalacion, carga de gas, limpieza y diagnostico de minisplits.',
    image: '/assets/category-climatizacion.webp',
    accent: '#475569',
    averagePrice: 1800,
    emergency: true,
    featured: false
  }
];

export const sessions: Record<Role, UserSession> = {
  cliente: {
    id: 'usr_cliente_1',
    name: 'Mariana Torres',
    email: 'cliente@conectapro.mx',
    role: 'cliente'
  },
  proveedor: {
    id: 'usr_proveedor_1',
    name: 'Grupo ServiHogar MX',
    email: 'proveedor@conectapro.mx',
    role: 'proveedor',
    providerId: 'prov_1'
  },
  admin: {
    id: 'usr_admin_1',
    name: 'Admin Operaciones',
    email: 'admin@conectapro.mx',
    role: 'admin'
  }
};

export const providers: Provider[] = [
  {
    id: 'prov_1',
    name: 'Grupo ServiHogar MX',
    trade: 'Cerrajeria, plomeria y CCTV',
    categoryIds: ['cerrajeria', 'plomeria', 'cctv'],
    verified: true,
    rating: 4.8,
    jobsCompleted: 186,
    subscription: {
      plan: 'Pro',
      status: 'activa',
      renewalDate: '2026-05-23',
      price: 499
    },
    location: {
      lat: 19.4328,
      lng: -99.1333,
      address: 'Centro Historico, CDMX'
    }
  },
  {
    id: 'prov_2',
    name: 'Albercas Cristalinas',
    trade: 'Limpieza y mantenimiento de albercas',
    categoryIds: ['albercas'],
    verified: false,
    rating: 4.6,
    jobsCompleted: 74,
    subscription: {
      plan: 'Basico',
      status: 'pendiente',
      renewalDate: '2026-04-30',
      price: 299
    },
    location: {
      lat: 19.3602,
      lng: -99.1874,
      address: 'Coyoacan, CDMX'
    }
  },
  {
    id: 'prov_3',
    name: 'Madera Fina Norte',
    trade: 'Carpinteria residencial',
    categoryIds: ['carpinteria', 'albanileria'],
    verified: true,
    rating: 4.9,
    jobsCompleted: 213,
    subscription: {
      plan: 'Elite',
      status: 'activa',
      renewalDate: '2026-06-02',
      price: 799
    },
    location: {
      lat: 19.4908,
      lng: -99.1777,
      address: 'Azcapotzalco, CDMX'
    }
  }
];

export const requests: ServiceRequest[] = [
  {
    id: 'req_1',
    title: 'Cambio de chapa principal y duplicado de llaves',
    categoryId: 'cerrajeria',
    clientId: sessions.cliente.id,
    providerId: 'prov_1',
    address: 'Roma Norte, Cuauhtemoc',
    city: 'Ciudad de Mexico',
    dateTime: isoFromNow(6),
    budget: 1100,
    distanceKm: 4.2,
    status: 'en_progreso',
    description: 'La chapa ya no cierra bien y necesito dos copias de llave para hoy.',
    location: { lat: 19.4194, lng: -99.1648 },
    createdAt: isoFromNow(-18),
    timeline: [
      {
        id: 'tl_1',
        status: 'abierta',
        label: 'Mariana publico la solicitud.',
        actor: 'cliente',
        createdAt: isoFromNow(-18)
      },
      {
        id: 'tl_2',
        status: 'cotizada',
        label: 'Grupo ServiHogar envio una cotizacion.',
        actor: 'proveedor',
        createdAt: isoFromNow(-16)
      },
      {
        id: 'tl_3',
        status: 'aceptada',
        label: 'Mariana acepto la cotizacion y deposito en escrow.',
        actor: 'cliente',
        createdAt: isoFromNow(-15)
      },
      {
        id: 'tl_4',
        status: 'en_progreso',
        label: 'El proveedor inicio el trabajo en sitio.',
        actor: 'proveedor',
        createdAt: isoFromNow(-1)
      }
    ],
    escrow: {
      amount: 1100,
      status: 'retenido'
    },
    quote: {
      providerId: 'prov_1',
      amount: 1100,
      message: 'Incluye chapa de seguridad, instalacion y dos duplicados.'
    }
  },
  {
    id: 'req_2',
    title: 'Instalar 4 camaras con acceso desde celular',
    categoryId: 'cctv',
    clientId: sessions.cliente.id,
    address: 'Narvarte Poniente',
    city: 'Ciudad de Mexico',
    dateTime: isoFromNow(48),
    budget: 5200,
    distanceKm: 6.8,
    status: 'abierta',
    description: 'Casa de dos niveles. Ya tengo internet de fibra y quiero grabacion continua.',
    location: { lat: 19.394, lng: -99.1562 },
    createdAt: isoFromNow(-4),
    timeline: [
      {
        id: 'tl_5',
        status: 'abierta',
        label: 'Solicitud publicada para proveedores verificados de CCTV.',
        actor: 'cliente',
        createdAt: isoFromNow(-4)
      }
    ],
    escrow: {
      amount: 0,
      status: 'sin_pago'
    }
  },
  {
    id: 'req_3',
    title: 'Limpieza profunda de alberca residencial',
    categoryId: 'albercas',
    clientId: 'usr_cliente_2',
    address: 'Jardines del Pedregal',
    city: 'Ciudad de Mexico',
    dateTime: isoFromNow(24),
    budget: 1700,
    distanceKm: 11.4,
    status: 'abierta',
    description: 'Alberca de 8x4 m con agua turbia. Requiero aspirado y balance de quimicos.',
    location: { lat: 19.3116, lng: -99.2083 },
    createdAt: isoFromNow(-6),
    timeline: [
      {
        id: 'tl_6',
        status: 'abierta',
        label: 'Solicitud disponible para proveedores con plan activo.',
        actor: 'cliente',
        createdAt: isoFromNow(-6)
      }
    ],
    escrow: {
      amount: 0,
      status: 'sin_pago'
    }
  },
  {
    id: 'req_4',
    title: 'Reparar mueble bajo tarja',
    categoryId: 'carpinteria',
    clientId: sessions.cliente.id,
    providerId: 'prov_3',
    address: 'Del Valle Centro',
    city: 'Ciudad de Mexico',
    dateTime: isoFromNow(-24),
    budget: 2400,
    distanceKm: 5.3,
    status: 'cerrada',
    description: 'La humedad dano una puerta y el fondo del gabinete.',
    location: { lat: 19.3867, lng: -99.162 },
    createdAt: isoFromNow(-96),
    timeline: [
      {
        id: 'tl_7',
        status: 'abierta',
        label: 'Solicitud creada con fotos del mueble.',
        actor: 'cliente',
        createdAt: isoFromNow(-96)
      },
      {
        id: 'tl_8',
        status: 'aceptada',
        label: 'Proveedor asignado y pago retenido.',
        actor: 'cliente',
        createdAt: isoFromNow(-90)
      },
      {
        id: 'tl_9',
        status: 'cerrada',
        label: 'Trabajo cerrado con liberacion de pago.',
        actor: 'cliente',
        createdAt: isoFromNow(-20)
      }
    ],
    escrow: {
      amount: 2400,
      status: 'liberado'
    },
    review: {
      rating: 5,
      comment: 'Trabajo limpio, puntual y con buen acabado.'
    }
  },
  {
    id: 'req_5',
    title: 'Fuga bajo lavabo con humedad en muro',
    categoryId: 'plomeria',
    clientId: 'usr_cliente_3',
    providerId: 'prov_1',
    address: 'Condesa',
    city: 'Ciudad de Mexico',
    dateTime: isoFromNow(2),
    budget: 1450,
    distanceKm: 3.5,
    status: 'disputa',
    description: 'La fuga regreso despues de la visita. Solicito revision o reembolso parcial.',
    location: { lat: 19.414, lng: -99.174 },
    createdAt: isoFromNow(-48),
    timeline: [
      {
        id: 'tl_10',
        status: 'abierta',
        label: 'Solicitud publicada por emergencia de plomeria.',
        actor: 'cliente',
        createdAt: isoFromNow(-48)
      },
      {
        id: 'tl_11',
        status: 'disputa',
        label: 'Cliente abrio disputa con evidencia fotografica.',
        actor: 'cliente',
        createdAt: isoFromNow(-3)
      }
    ],
    escrow: {
      amount: 1450,
      status: 'retenido'
    },
    dispute: {
      reason: 'La fuga continua despues de la reparacion.',
      status: 'abierta'
    }
  }
];

export const chatMessages: ChatMessage[] = [
  {
    id: 'msg_1',
    requestId: 'req_1',
    senderRole: 'cliente',
    senderName: 'Mariana',
    message: 'Hola, tengo estacionamiento para que puedas entrar con herramienta.',
    createdAt: isoFromNow(-2)
  },
  {
    id: 'msg_2',
    requestId: 'req_1',
    senderRole: 'proveedor',
    senderName: 'ServiHogar',
    message: 'Perfecto. Llegamos entre 5:30 y 6:00 pm.',
    createdAt: isoFromNow(-1.5)
  },
  {
    id: 'msg_3',
    requestId: 'req_5',
    senderRole: 'admin',
    senderName: 'Soporte App Proveedores',
    message: 'Estamos revisando la evidencia y contactaremos al proveedor hoy.',
    createdAt: isoFromNow(-1)
  }
];

export const notifications: NotificationEvent[] = [
  {
    id: 'not_1',
    title: 'Nueva solicitud cercana',
    message: 'Hay una solicitud de CCTV a 6.8 km con presupuesto de $5,200.',
    role: 'proveedor',
    createdAt: isoFromNow(-4)
  },
  {
    id: 'not_2',
    title: 'Pago retenido',
    message: 'Tu pago de cerrajeria esta protegido hasta cerrar el servicio.',
    role: 'cliente',
    createdAt: isoFromNow(-15)
  },
  {
    id: 'not_3',
    title: 'Disputa abierta',
    message: 'Una solicitud de plomeria requiere resolucion del equipo admin.',
    role: 'admin',
    createdAt: isoFromNow(-3)
  }
];

export const heatPoints: HeatPoint[] = [
  { id: 'hp_1', label: 'Roma Norte', lat: 19.4194, lng: -99.1648, intensity: 88, categoryId: 'cerrajeria' },
  { id: 'hp_2', label: 'Narvarte', lat: 19.394, lng: -99.1562, intensity: 74, categoryId: 'cctv' },
  { id: 'hp_3', label: 'Pedregal', lat: 19.3116, lng: -99.2083, intensity: 62, categoryId: 'albercas' },
  { id: 'hp_4', label: 'Condesa', lat: 19.414, lng: -99.174, intensity: 91, categoryId: 'plomeria' },
  { id: 'hp_5', label: 'Del Valle', lat: 19.3867, lng: -99.162, intensity: 58, categoryId: 'carpinteria' }
];

export const metrics: Metrics = {
  activeRequests: 42,
  activeProviders: 318,
  escrowBalance: 248_600,
  disputesOpen: 5,
  conversionRate: 68
};
