extern crate proc_macro;

use proc_macro::TokenStream;
use quote::quote;
use syn::parse;
use syn::{
    parse_macro_input, spanned::Spanned, FnArg, GenericArgument, ItemFn, LitInt, PathArguments,
    ReturnType, Type, TypePath, TypeReference, TypeSlice, Visibility,
};

/// `&[u8]`
fn is_slice_u8(ty: &Type) -> bool {
    matches!(
        ty,
        Type::Reference(TypeReference {
            lifetime: None,
            mutability: None,
            elem,
            ..
        }) if matches!(
            &**elem,
            Type::Slice(TypeSlice { elem: inner, .. })
            if matches!(&**inner, Type::Path(p) if p.qself.is_none() && p.path.is_ident("u8"))
        )
    )
}

/// `u64`
fn is_u64(ty: &Type) -> bool {
    matches!(ty, Type::Path(p) if p.qself.is_none() && p.path.is_ident("u64"))
}

/// `AccountManager<N>` where N is a const generic
fn is_account_manager(ty: &Type) -> bool {
    let Type::Path(TypePath { qself: None, path }) = ty else {
        return false;
    };

    let Some(last_segment) = path.segments.last() else {
        return false;
    };

    if last_segment.ident != "AccountManager" {
        return false;
    }

    let PathArguments::AngleBracketed(ab) = &last_segment.arguments else {
        return false;
    };

    /* Check that there's exactly one generic argument (the const N) */
    ab.args.len() == 1
}

/// `Result<u64, u64>`
fn is_result_u64_u64(ty: &Type) -> bool {
    let Type::Path(TypePath { qself: None, path }) = ty else {
        return false;
    };

    let [syn::PathSegment { ident, arguments }] =
        path.segments.iter().collect::<Vec<_>>().as_slice()
    else {
        return false;
    };

    if ident != "Result" {
        return false;
    }

    let PathArguments::AngleBracketed(ab) = arguments else {
        return false;
    };

    let [GenericArgument::Type(t1), GenericArgument::Type(t2)] =
        ab.args.iter().collect::<Vec<_>>().as_slice()
    else {
        return false;
    };

    if !is_u64(t1) || !is_u64(t2) {
        return false;
    }

    true
}

fn is_never(ty: &Type) -> bool {
    matches!(ty, Type::Never(_))
}

// Error if invalid signature, else returns (is_result_u64_u64, expects_account_manager)
fn parse_signature(fn_item: &syn::ItemFn) -> Result<(bool, bool), ()> {
    let syn::ItemFn {
        attrs: _,
        vis: Visibility::Inherited,
        sig:
            syn::Signature {
                constness: None,
                asyncness: None,
                unsafety: None,
                abi: None,
                fn_token: _,
                ident: _,
                generics:
                    syn::Generics {
                        lt_token: None,
                        params: generic_params,
                        gt_token: None,
                        where_clause: None,
                    },
                paren_token: _,
                inputs,
                variadic: None,
                output,
            },
        block: _,
    } = fn_item
    else {
        return Err(());
    };

    /* Function should not be generic */
    if !generic_params.is_empty() {
        return Err(());
    }

    // Expect either one parameter (&[u8]) or two parameters (&[u8], AccountManager<N>)
    let inputs_vec = inputs.iter().collect::<Vec<_>>();
    let expects_account_manager = match inputs_vec.as_slice() {
        [arg1] => {
            let FnArg::Typed(arg1) = arg1 else {
                return Err(());
            };

            if !is_slice_u8(arg1.ty.as_ref()) {
                return Err(());
            }

            false
        }
        [arg1, arg2] => {
            let FnArg::Typed(arg1) = arg1 else {
                return Err(());
            };
            let FnArg::Typed(arg2) = arg2 else {
                return Err(());
            };

            if !is_slice_u8(arg1.ty.as_ref()) {
                return Err(());
            }

            if !is_account_manager(arg2.ty.as_ref()) {
                return Err(());
            }

            true
        }
        _ => return Err(()),
    };

    let ReturnType::Type(_, ty) = output else {
        return Err(());
    };

    if is_result_u64_u64(ty) {
        return Ok((true, expects_account_manager));
    }

    if is_never(ty) {
        return Ok((false, expects_account_manager));
    }

    Err(())
}

#[proc_macro_attribute]
pub fn entry(args: TokenStream, input: TokenStream) -> TokenStream {
    let macro_input = parse_macro_input!(input as ItemFn);
    if args.is_empty() {
        return parse::Error::new(
            macro_input.span(),
            "`Usage: #[entry((optional) stack_size = BYTES)]`",
        )
        .to_compile_error()
        .into();
    }

    let mut stack_size = quote! { 4096 };
    let entry_meta_parser = syn::meta::parser(|meta| {
        if meta.path.is_ident("stack_size") {
            let lit: LitInt = meta.value()?.parse()?;
            let value: u64 = lit.base10_parse()?;
            if value % 4096 != 0 {
                return Err(syn::Error::new(
                    lit.span(),
                    "stack_size must be a multiple of 4096 (4kb)",
                ));
            }
            stack_size = quote! { #lit };
        } else {
            return Err(meta.error("unsupported tea property"));
        }
        Ok(())
    });

    parse_macro_input!(args with entry_meta_parser);

    let boot_shim = quote! {
        #[doc(hidden)]
        #[unsafe(link_section = ".text._start")]
        #[unsafe(no_mangle)]
        #[unsafe(naked)]
        pub unsafe extern "C" fn _start() -> ! {
            const STACK_SIZE: i64 = #stack_size;

            core::arch::naked_asm!(
                // Emit CFI to .debug_frame section (matches C SDK behavior)
                ".cfi_sections .debug_frame",
                ".cfi_startproc",

                // Check transaction version (must be 1 for backwards compatibility)
                // TXN_DATA segment: 0x00_0001_000000, version at offset 0
                "li     t5, 0x0001000000",
                "lbu    t5, 0(t5)",         // Load transaction version byte
                "addi   t5, t5, -1",        // version - 1
                "bnez   t5, 1f",            // Revert if version != 1

                // Save instruction data pointer
                "mv     t0, a0",

                // Load shadow stack base: 0x00_0002_000000 (SEG_TYPE_READONLY_DATA, SEG_IDX_SHADOW_STACK)
                "li     t1, 0x0002000000",

                // Read call_depth (ushort at offset 0)
                "lhu    t2, 0(t1)",

                // Calculate parent frame offset: 8 + ((call_depth - 1) * 264)
                // Frame size = 6 bytes (3 x ushort) + 2 padding + 256 bytes (32 x ulong saved_regs) = 264 bytes
                "addi   t2, t2, -1",
                "li     t3, 264",
                "mul    t2, t2, t3",
                "addi   t2, t2, 8",
                "add    t1, t1, t2",         // t1 = &parent_frame

                // Read parent frame's stack_pages (ushort at offset 2 in frame)
                "lhu    t2, 2(t1)",

                // Convert pages to bytes: parent_stack_bytes = stack_pages * 4096
                "slli   t2, t2, 12",

                // Calculate stack address: STACK_SEG_START - parent_stack_bytes
                // STACK_SEG_START = (0x05 << 40) | (0x0001 << 24) = 0x05_0001_000000
                "li     t3, 0x05",
                "slli   t3, t3, 40",
                "li     t4, 0x0001",
                "slli   t4, t4, 24",
                "or     t3, t3, t4",            // t3 = STACK_SEG_START
                "sub    t3, t3, t2",            // t3 = STACK_SEG_START - parent_stack_bytes

                // Add current invocation's stack size for syscall
                "li     t4, {STACK_SIZE}",
                "sub    a0, t3, t4",            // a0 = sp - STACK_SIZE (address for syscall)

                // Set stack pointer to STACK_SEG_START - parent_stack_bytes
                "mv     sp, t3",

                // Syscall 0: set_anonymous_segment_sz(vaddr)
                "li     a7, 0",
                "ecall",

                // If syscall failed, revert
                "bnez   a0, 1f",

                // Allocate stack frame and save state for unwinding
                "addi   sp, sp, -32",
                ".cfi_def_cfa_register sp",
                ".cfi_def_cfa_offset 32",
                "sd     ra, 24(sp)",           // Save ra at sp+24 (cfa-8)
                "sd     s0, 16(sp)",           // Save s0 at sp+16 (cfa-16)
                ".cfi_offset ra, -8",
                ".cfi_offset s0, -16",

                // Call program entry point
                "mv     a0, t0",
                "call   start",

                "1:",
                // Syscall 11: exit(error_code, revert=1)
                "li     a7, 11",
                "li     a1, 1",
                "ecall",

                ".cfi_endproc",

                STACK_SIZE = const STACK_SIZE,
            );
        }
    };

    let Ok((is_result6464, expects_account_manager)) = parse_signature(&macro_input) else {
        return parse::Error::new(
            macro_input.span(),
            "`#[entry]` function must have signature `fn(input: &[u8]) -> Result<u64, u64>` or `fn(input: &[u8], mgr: AccountManager<N>) -> Result<u64, u64>` (and may return !)",
        )
        .to_compile_error()
        .into();
    };

    let ident = &macro_input.sig.ident;
    let user_fn = &macro_input;

    let account_manager_init = if expects_account_manager {
        quote! {
            /* Create AccountManager from the transaction */
            let txn = ::thru_core::get_txn();
            let mgr = match ::thru_core::AccountManager::from_txn(txn) {
                Ok(mgr) => mgr,
                Err(_) => ::thru_core::syscall::sys_exit(1, 1),
            };
        }
    } else {
        quote! {}
    };

    let user_call = if expects_account_manager {
        quote! { #ident(data, mgr) }
    } else {
        quote! { #ident(data) }
    };

    if is_result6464 {
        quote! {
            #boot_shim

            #user_fn

            #[doc(hidden)]
            #[unsafe(link_section = ".text.start")]
            #[unsafe(export_name = "start")]
            pub extern "C" fn start(instr_data: *const u8, instr_data_sz: u64) -> ! {
                use core::arch::asm;

                let data: &[u8] = if instr_data.is_null() {
                    &[]
                } else {
                    unsafe { core::slice::from_raw_parts(instr_data, instr_data_sz as usize) }
                };

                #account_manager_init

                /* Run user function */
                let __result: core::result::Result<u64, u64> = #user_call;

                let (__exit_code, __revert): (u64, u64) = match __result {
                    Ok(code)  => (code, 0),
                    Err(code) => (code, 1),
                };

                thru_core::syscall::sys_exit(__exit_code, __revert);
            }
        }
    } else {
        quote! {
            #boot_shim

            #user_fn

            #[doc(hidden)]
            #[unsafe(link_section = ".text.start")]
            #[unsafe(export_name = "start")]
            pub extern "C" fn start(instr_data: *const u8, instr_data_sz: u64) -> ! {
                use core::arch::asm;

                let data: &[u8] = if instr_data.is_null() {
                    &[]
                } else {
                    unsafe { core::slice::from_raw_parts(instr_data, instr_data_sz as usize) }
                };

                #account_manager_init

                /* Run user function */
                #user_call;
            }
        }
    }
    .into()
}
