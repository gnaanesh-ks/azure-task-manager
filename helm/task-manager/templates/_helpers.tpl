{{- define "task-manager.fullname" -}}
{{ .Release.Name }}
{{- end -}}

{{- define "task-manager.image" -}}
{{ .root.Values.image.registry }}/{{ .repository }}:{{ .root.Values.image.tag }}
{{- end -}}

{{- define "task-manager.serviceAccountName" -}}
{{ .Values.serviceAccount.name | default "task-manager" }}
{{- end -}}

{{- define "task-manager.databaseUrl" -}}
{{- if .Values.postgresql.enabled -}}
postgresql://{{ .Values.postgresql.username }}:{{ .Values.secrets.postgresPassword }}@{{ .Release.Name }}-postgresql:5432/{{ .Values.postgresql.database }}
{{- else if .Values.externalDatabaseUrl -}}
{{ .Values.externalDatabaseUrl }}
{{- else -}}
postgresql://{{ .Values.externalDatabase.username }}:{{ .Values.secrets.postgresPassword }}@{{ .Values.externalDatabase.host }}:{{ .Values.externalDatabase.port }}/{{ .Values.externalDatabase.database }}?sslmode={{ .Values.externalDatabase.sslmode }}
{{- end -}}
{{- end -}}
