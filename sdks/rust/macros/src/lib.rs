extern crate proc_macro;

use proc_macro::TokenStream;
use quote::quote;
use syn::parse;
use syn::{
    FnArg, GenericArgument, ItemFn, LitInt, PathArguments, ReturnType, Type, TypePath,
    TypeReference, TypeSlice, Visibility, parse_macro_input, spanned::Spanned,
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

/// `Result<u64, u64>`
fn is_result_u64_u64(ty: &Type) -> bool {
    let Type::Path(TypePath { qself: None, path }) = ty else {
        return false;
    };

    let [syn::PathSegment { ident, arguments }] = path.segments.iter().collect::<Vec<_>>().as_slice() else {
        return false;
    };

    if ident != "Result" {
        return false;
    }

    let PathArguments::AngleBracketed(ab) = arguments else {
        return false;
    };

    let [GenericArgument::Type(t1), GenericArgument::Type(t2)] = ab.args.iter().collect::<Vec<_>>().as_slice() else {
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

// Error if invalid signature, else true if return type is Result<u64, u64> or false if never
fn parse_signature(fn_item: &syn::ItemFn) -> Result<bool, ()> {
    let syn::ItemFn {
        attrs: _,
        vis: Visibility::Inherited,
        sig: syn::Signature {
            constness: None,
            asyncness: None,
            unsafety: None,
            abi: None,
            fn_token: _,
            ident: _,
            generics: syn::Generics {
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
        block: _
    } = fn_item else {
        return Err(());
    };

    if !generic_params.is_empty() {
        return Err(());
    }

    let [FnArg::Typed(syn::PatType {
        ty,
        .. // TODO: Check exhaustively. Shouldn't have anything funny.
    })] = inputs.iter().collect::<Vec<_>>().as_slice() else {
        return Err(());
    };

    if !is_slice_u8(ty) {
        return Err(());
    }

    let ReturnType::Type(_, ty) = output else {
        return Err(());
    };

    if is_result_u64_u64(ty) {
        return Ok(true);
    }

    if is_never(ty) {
        return Ok(false)
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
        pub unsafe extern "C" fn _start() -> ! {
            const SP_ALIGN: u64 =  0xFFFF_FFFF_FFFF_F000; // -4096
            const STACK_SIZE: i64 = #stack_size;
            core::arch::asm!(
                "mv     t0, a0",
                "li     t2, {ALIGN}",
                "and    sp, sp, t2",
                "mv     a0, sp",
                "li     t2, {STACK_INC}",
                "add    a0, a0, t2",
                "li     a7, 0",  // sys_set_anonymous_segment_sz
                "ecall",
                "bnez   a0, 2f",
                "mv     a0, t0",
                "call   start",
                "2:", // label .L_revert
                "li     a7, 11", // syscall: exit
                "li     a1, 1",
                "ecall",
                ALIGN = const SP_ALIGN,
                STACK_INC = const -1 * STACK_SIZE,
                options(noreturn)
            );
        }
    };

    let Ok(is_result6464) = parse_signature(&macro_input) else {
        return parse::Error::new(
            macro_input.span(),
            "`#[entry]` function must have signature `fn(input: &[u8]) -> Result<u64, u64>`",
        )
        .to_compile_error()
        .into();
    };

    let ident = &macro_input.sig.ident;
    let user_fn = &macro_input;

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
                // run user function
                let __result: core::result::Result<u64, u64> = #ident(data);

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
                // run user function
                #ident(data);
            }
        }
    }.into()
}
