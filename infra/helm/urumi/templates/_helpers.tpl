{{/*
Chart name, truncated to 63 chars.
*/}}
{{- define "urumi.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name.
If release name contains the chart name, use release name only.
*/}}
{{- define "urumi.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels applied to all resources.
*/}}
{{- define "urumi.labels" -}}
helm.sh/chart: {{ printf "%s-%s" (include "urumi.name" .) .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
{{- end }}

{{/*
Secret name for the chart.
*/}}
{{- define "urumi.secretName" -}}
{{- printf "%s-secrets" (include "urumi.fullname" .) }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "urumi.selectorLabels" -}}
app.kubernetes.io/name: {{ include "urumi.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
