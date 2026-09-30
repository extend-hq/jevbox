{{- define "jevbox.name" -}}
{{- printf "%s-jevbox" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- define "jevbox.labels" -}}
app.kubernetes.io/name: jevbox
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
{{- define "jevbox.guard" -}}
{{- if and .Values.networkPolicy.enabled (not .Values.postgres.allowedCidrs) -}}
{{- fail "Set postgres.allowedCidrs to the private PostgreSQL endpoint ranges" -}}
{{- end -}}
{{- if not (hasPrefix "https://" .Values.appOrigin) -}}
{{- fail "appOrigin must be an explicit HTTPS origin" -}}
{{- end -}}
{{- if or (not .Values.image.repository) (not .Values.image.tag) (eq .Values.image.tag "latest") -}}
{{- fail "Set image.repository and an immutable image.tag" -}}
{{- end -}}
{{- if and .Values.networkPolicy.enabled (not .Values.networkPolicy.ingressNamespace) (not .Values.networkPolicy.ingressCidrs) -}}
{{- fail "Set networkPolicy.ingressNamespace or networkPolicy.ingressCidrs" -}}
{{- end -}}
{{- if and .Values.ingress.enabled (not .Values.ingress.tlsSecretName) -}}
{{- if ne .Values.ingress.className "alb" -}}
{{- fail "Set ingress.tlsSecretName for HTTPS" -}}
{{- end -}}
{{- if not (index .Values.ingress.annotations "alb.ingress.kubernetes.io/certificate-arn") -}}
{{- fail "Set the ALB certificate-arn annotation for HTTPS" -}}
{{- end -}}
{{- if ne (index .Values.ingress.annotations "alb.ingress.kubernetes.io/ssl-redirect") "443" -}}
{{- fail "Set the ALB ssl-redirect annotation to 443" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "jevbox.spicedbLabels" -}}
app.kubernetes.io/name: jevbox-spicedb
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
