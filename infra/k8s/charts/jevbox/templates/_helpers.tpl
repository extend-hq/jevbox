{{- define "jevbox.name" -}}
{{- printf "%s-jevbox" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- define "jevbox.labels" -}}
app.kubernetes.io/name: jevbox
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
{{- define "jevbox.guard" -}}
{{- if regexMatch "(?i)prod[-_]?1" (printf "%s/%s" .Release.Name .Release.Namespace) -}}
{{- fail "Deployment to PROD 1 is prohibited" -}}
{{- end -}}
{{- if and .Values.networkPolicy.enabled (not .Values.postgres.allowedCidrs) -}}
{{- fail "Set postgres.allowedCidrs to the private PostgreSQL endpoint ranges" -}}
{{- end -}}
{{- if not (hasPrefix "https://" .Values.appOrigin) -}}
{{- fail "appOrigin must be an explicit HTTPS origin" -}}
{{- end -}}
{{- if or (not .Values.image.repository) (not .Values.image.tag) (eq .Values.image.tag "latest") -}}
{{- fail "Set image.repository and an immutable image.tag" -}}
{{- end -}}
{{- end -}}

{{- define "jevbox.spicedbLabels" -}}
app.kubernetes.io/name: jevbox-spicedb
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
