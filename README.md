# Nomina al Dia

Estimador de nomina para periodos del 24 al 23, creado por Ivan Simeoni.

La app ayuda a cargar partes de trabajo en PDF, extraer horarios, revisar nocturnidad, disponibilidad, dietas y guardar una copia local de los datos.

## Importante sobre privacidad

Esta app esta pensada para funcionar en local en el navegador.

- No guarda los PDF completos.
- No sube partes ni nominas a un servidor propio.
- Guarda solo los datos extraidos y las anotaciones del usuario.
- Cada persona que use el enlace conserva sus datos en su propio navegador.
- La copia de seguridad se descarga como archivo JSON.

## Funciones principales

- Carga de partes PDF.
- Deteccion de fecha, presentacion, cierre y libre disposicion.
- Calculo de horas computables.
- Calculo de nocturnidad.
- Dietas automaticas por horario, corregibles a mano.
- Marca manual de descanso trabajado.
- Marca manual de festivo trabajado.
- Marca manual de servicio discrecional nacional.
- Comparacion contra datos de nomina real.
- Guardar y restaurar copia JSON.
- Preparada como PWA para instalar en Android/iPhone desde el navegador.

## Como instalar en Android

1. Abrir la URL publicada en Chrome.
2. Tocar el menu de tres puntos.
3. Elegir `Anadir a pantalla de inicio` o `Instalar app`.
4. Abrirla desde el icono creado.

## Como instalar en iPhone

1. Abrir la URL publicada en Safari.
2. Tocar el boton de compartir.
3. Elegir `Anadir a pantalla de inicio`.
4. Abrirla desde el icono creado.

## Copias de seguridad

La app guarda datos en el navegador, pero conviene descargar una copia periodicamente.

Usar el boton:

```text
Guardar copia
```

Eso descarga un archivo JSON con el periodo, las reglas, los dias cargados y las anotaciones.

Para recuperar datos, usar:

```text
Restaurar JSON
```

## Aviso

Esta herramienta es un estimador y ayuda de revision. Los calculos pueden necesitar ajustes segun convenio, pactos internos, criterios de empresa o cambios en el formato de los partes.
