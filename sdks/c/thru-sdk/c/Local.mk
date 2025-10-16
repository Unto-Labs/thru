# ThruNet C SDK Library Build Rules
# This file defines the library components of the ThruNet SDK

##############################
# ThruNet SDK Library

$(call make-lib,tn_sdk)

# Add SDK objects to library
$(call add-objs,tn_sdk,tn_sdk)
$(call add-objs,tn_sdk_syscall,tn_sdk)
$(call add-objs,tn_sdk_sha256,tn_sdk)

# Add assembly files to library
$(call add-asms,entrypoint,tn_sdk)

# Add headers
$(call add-hdrs,tn_sdk.h tn_sdk_base.h tn_sdk_syscall.h tn_sdk_sha256.h tn_sdk_types.h tn_sdk_txn.h)

 