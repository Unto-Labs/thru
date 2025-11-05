# Build configuration for {{PROJECT_NAME}}
# This file defines which programs to build

$(call make-bin,{{PROGRAM_NAME}}_c,{{PROGRAM_NAME}},,-ltn_sdk)
