{{- define "jevbox.name" -}}
{{- printf "%s-jevbox" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- define "jevbox.labels" -}}
app.kubernetes.io/name: jevbox
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
{{- define "jevbox.guard" -}}
{{- if not (has .Values.storage.backend (list "s3" "postgres")) -}}
{{- fail "storage.backend must be s3 or postgres" -}}
{{- end -}}
{{- if and (eq .Values.storage.backend "s3") (or (not .Values.storage.bucket) (not .Values.storage.region)) -}}
{{- fail "Set storage.bucket and storage.region for S3 storage" -}}
{{- end -}}
{{- if and (not .Values.serviceAccount.create) (not .Values.serviceAccount.name) -}}
{{- fail "Set serviceAccount.name when using an existing service account" -}}
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

{{- define "jevbox.serviceAccountName" -}}
{{- default (include "jevbox.name" .) .Values.serviceAccount.name -}}
{{- end -}}

{{- define "jevbox.storageEnv" -}}
- name: FILE_STORAGE
  value: {{ .Values.storage.backend | quote }}
{{- if eq .Values.storage.backend "s3" }}
- name: S3_BUCKET
  value: {{ .Values.storage.bucket | quote }}
- name: AWS_REGION
  value: {{ .Values.storage.region | quote }}
- name: AWS_STS_REGIONAL_ENDPOINTS
  value: regional
- name: S3_ENDPOINT
  value: {{ .Values.storage.endpoint | quote }}
- name: S3_FORCE_PATH_STYLE
  value: {{ .Values.storage.forcePathStyle | quote }}
- name: S3_PREFIX
  value: {{ .Values.storage.prefix | quote }}
{{- range list "AWS_ACCESS_KEY_ID" "AWS_SECRET_ACCESS_KEY" "AWS_SESSION_TOKEN" }}
- name: {{ . }}
  valueFrom:
    secretKeyRef:
      name: {{ default $.Values.existingSecret $.Values.storage.credentialsSecret }}
      key: {{ . }}
      optional: true
{{- end }}
{{- end }}
{{- end -}}
