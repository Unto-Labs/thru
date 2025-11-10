# ThruNet C++ SDK Library Build Rules
# This file defines the library components of the ThruNet C++ SDK

##############################
# ThruNet C++ SDK Library

$(call make-lib,tn_sdk)

# Add SDK objects to library
$(call add-objs,tn_sdk,tn_sdk)
$(call add-objs,tn_sdk_syscall,tn_sdk)

# Add assembly files to library
$(call add-asms,entrypoint,tn_sdk)

# Add headers
$(call add-hdrs,tn_sdk.hpp tn_sdk_base.hpp tn_sdk_syscall.hpp) 