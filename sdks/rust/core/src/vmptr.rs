//! Provenance-aware pointer utilities for safe memory access in the Thru VM.
//!
//! This module provides types and functions that respect Rust's pointer provenance model
//! (RFC 3559) when working with VM-provided memory regions. The key insight is that
//! pointers have two components:
//!
//! 1. **Address**: The numeric memory location (can be extracted with `addr()`)
//! 2. **Provenance**: Permission metadata that determines which memory the pointer
//!    may access (tracked by the compiler/runtime)
//!
//! # VM Memory Model
//!
//! The Thru VM provides memory through computed segment addresses:
//! ```text
//! | seg_type (8 bits) | seg_idx (16 bits) | offset (24 bits) |
//! ```
//!
//! Since these addresses come from the VM (crossing the FFI boundary via syscalls),
//! we use "exposed provenance" semantics. The VM implicitly grants provenance over
//! the memory it provides.
//!
//! # Strict vs Exposed Provenance
//!
//! - **Strict Provenance** (`with_addr`, `map_addr`): Preserves provenance from an
//!   existing pointer. Use when deriving new pointers from existing ones.
//!
//! - **Exposed Provenance** (`expose_provenance`, `with_exposed_provenance`): For
//!   pointers that cross FFI boundaries. The VM runtime grants provenance implicitly.
//!
//! # Safety Guidelines
//!
//! 1. Never cast integers to pointers directly (`addr as *const T`)
//! 2. Use `VmPtr::from_segment()` for computed segment addresses
//! 3. Use `VmPtr::with_addr()` to derive new pointers from existing ones
//! 4. Before syscalls: `expose_provenance()` on any pointer being passed
//! 5. After syscalls: `with_exposed_provenance()` to reconstruct pointers

use core::marker::PhantomData;
use core::ptr;

/// A provenance-aware pointer to VM memory.
///
/// `VmPtr<T>` wraps a raw pointer while tracking that it has valid provenance
/// over VM-provided memory. This type prevents accidental pointer-integer-pointer
/// round trips that would lose provenance.
///
/// # Example
///
/// ```rust
/// use thru_core::provenance::VmPtr;
///
/// // Create from a VM segment address
/// let ptr: VmPtr<u8> = unsafe {
///     VmPtr::from_segment(SEG_TYPE_READONLY_DATA, SEG_IDX_TXN_DATA, 0)
/// };
///
/// // Derive a new pointer at an offset (preserves provenance)
/// let offset_ptr = ptr.offset(10);
///
/// // Read the value
/// let value = unsafe { offset_ptr.read() };
/// ```
#[repr(transparent)]
pub struct VmPtr<T> {
    ptr: *const T,
    _marker: PhantomData<T>,
}

impl<T> Clone for VmPtr<T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> Copy for VmPtr<T> {}

impl<T> VmPtr<T> {
    /// Create a `VmPtr` from a raw pointer.
    ///
    /// # Safety
    ///
    /// The pointer must have valid provenance over the memory it points to.
    /// This is typically true for pointers obtained from:
    /// - References (`&T`, `&mut T`)
    /// - Allocation functions
    /// - VM syscalls via `with_exposed_provenance`
    #[inline]
    pub const unsafe fn from_raw(ptr: *const T) -> Self {
        Self {
            ptr,
            _marker: PhantomData,
        }
    }

    /// Create a `VmPtr` from a VM segment address.
    ///
    /// This computes the address from segment type, index, and offset, then
    /// creates a pointer with exposed provenance (suitable for VM memory).
    ///
    /// # Safety
    ///
    /// The computed address must be valid for the VM's memory layout.
    /// The caller must ensure the segment is mapped and accessible.
    #[inline]
    pub unsafe fn from_segment(seg_type: usize, seg_idx: usize, offset: usize) -> Self {
        let addr = compute_segment_addr(seg_type, seg_idx, offset);
        Self {
            ptr: ptr::with_exposed_provenance(addr),
            _marker: PhantomData,
        }
    }

    /// Create a `VmPtr` from an address with exposed provenance.
    ///
    /// Use this when reconstructing a pointer from an integer that was
    /// previously exposed (e.g., from a syscall return value).
    ///
    /// # Safety
    ///
    /// The address must correspond to memory whose provenance was previously
    /// exposed via `expose_provenance()`.
    #[inline]
    pub unsafe fn from_exposed_addr(addr: usize) -> Self {
        Self {
            ptr: ptr::with_exposed_provenance(addr),
            _marker: PhantomData,
        }
    }

    /// Get the address of this pointer without exposing provenance.
    ///
    /// Use this when you need the numeric address for comparison or
    /// arithmetic but don't intend to create a new pointer from it.
    #[inline]
    pub fn addr(self) -> usize {
        // Use strict provenance API to get address without exposing
        self.ptr.addr()
    }

    /// Expose the provenance of this pointer and return its address.
    ///
    /// Call this before passing the pointer to a syscall. The provenance
    /// is added to a global "exposed" set that `with_exposed_provenance`
    /// can later retrieve.
    #[inline]
    pub fn expose_provenance(self) -> usize {
        self.ptr.expose_provenance()
    }

    /// Get the raw pointer.
    ///
    /// Prefer using the safe methods on `VmPtr` when possible.
    #[inline]
    pub const fn as_ptr(self) -> *const T {
        self.ptr
    }

    /// Convert to a mutable pointer.
    ///
    /// # Safety
    ///
    /// The underlying memory must be mutable.
    #[inline]
    pub const fn as_mut_ptr(self) -> *mut T {
        self.ptr as *mut T
    }

    /// Create a new pointer at an offset from this one.
    ///
    /// This uses strict provenance to preserve the original pointer's
    /// provenance while changing only the address.
    ///
    /// # Safety
    ///
    /// The resulting address must be within the same allocation.
    #[inline]
    pub unsafe fn offset(self, count: isize) -> Self {
        Self {
            ptr: self.ptr.offset(count),
            _marker: PhantomData,
        }
    }

    /// Create a new pointer by adding bytes to the address.
    ///
    /// This uses strict provenance to preserve the original pointer's
    /// provenance while changing only the address.
    ///
    /// # Safety
    ///
    /// The resulting address must be within the same allocation.
    #[inline]
    pub unsafe fn byte_add(self, bytes: usize) -> Self {
        Self {
            ptr: self.ptr.byte_add(bytes),
            _marker: PhantomData,
        }
    }

    /// Read the value at this pointer.
    ///
    /// # Safety
    ///
    /// - The pointer must be properly aligned for `T`
    /// - The memory must be initialized with a valid `T`
    /// - The memory must not be concurrently written
    #[inline]
    pub unsafe fn read(self) -> T {
        ptr::read(self.ptr)
    }

    /// Read the value at this pointer without alignment requirements.
    ///
    /// # Safety
    ///
    /// - The memory must be initialized with a valid `T`
    /// - The memory must not be concurrently written
    #[inline]
    pub unsafe fn read_unaligned(self) -> T {
        ptr::read_unaligned(self.ptr)
    }

    /// Cast to a pointer of a different type.
    ///
    /// Provenance is preserved through the cast.
    #[inline]
    pub fn cast<U>(self) -> VmPtr<U> {
        VmPtr {
            ptr: self.ptr.cast(),
            _marker: PhantomData,
        }
    }

    /// Check if this pointer is null.
    #[inline]
    pub fn is_null(self) -> bool {
        self.ptr.is_null()
    }
}

/// A provenance-aware mutable pointer to VM memory.
#[repr(transparent)]
pub struct VmPtrMut<T> {
    ptr: *mut T,
    _marker: PhantomData<T>,
}

impl<T> Clone for VmPtrMut<T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> Copy for VmPtrMut<T> {}

impl<T> VmPtrMut<T> {
    /// Create a `VmPtrMut` from a raw mutable pointer.
    ///
    /// # Safety
    ///
    /// The pointer must have valid provenance over the memory it points to.
    #[inline]
    pub const unsafe fn from_raw(ptr: *mut T) -> Self {
        Self {
            ptr,
            _marker: PhantomData,
        }
    }

    /// Create a `VmPtrMut` from a VM segment address.
    ///
    /// # Safety
    ///
    /// The computed address must be valid and the segment must be writable.
    #[inline]
    pub unsafe fn from_segment(seg_type: usize, seg_idx: usize, offset: usize) -> Self {
        let addr = compute_segment_addr(seg_type, seg_idx, offset);
        Self {
            ptr: ptr::with_exposed_provenance_mut(addr),
            _marker: PhantomData,
        }
    }

    /// Create a `VmPtrMut` from an address with exposed provenance.
    ///
    /// # Safety
    ///
    /// The address must correspond to writable memory whose provenance was
    /// previously exposed.
    #[inline]
    pub unsafe fn from_exposed_addr(addr: usize) -> Self {
        Self {
            ptr: ptr::with_exposed_provenance_mut(addr),
            _marker: PhantomData,
        }
    }

    /// Get the address without exposing provenance.
    #[inline]
    pub fn addr(self) -> usize {
        self.ptr.addr()
    }

    /// Expose provenance and return the address.
    #[inline]
    pub fn expose_provenance(self) -> usize {
        self.ptr.expose_provenance()
    }

    /// Get the raw mutable pointer.
    #[inline]
    pub const fn as_mut_ptr(self) -> *mut T {
        self.ptr
    }

    /// Get as a const pointer.
    #[inline]
    pub const fn as_ptr(self) -> *const T {
        self.ptr
    }

    /// Create a new pointer at an offset.
    ///
    /// # Safety
    ///
    /// The resulting address must be within the same allocation.
    #[inline]
    pub unsafe fn offset(self, count: isize) -> Self {
        Self {
            ptr: self.ptr.offset(count),
            _marker: PhantomData,
        }
    }

    /// Create a new pointer by adding bytes.
    ///
    /// # Safety
    ///
    /// The resulting address must be within the same allocation.
    #[inline]
    pub unsafe fn byte_add(self, bytes: usize) -> Self {
        Self {
            ptr: self.ptr.byte_add(bytes),
            _marker: PhantomData,
        }
    }

    /// Read the value.
    ///
    /// # Safety
    ///
    /// Same requirements as `VmPtr::read`.
    #[inline]
    pub unsafe fn read(self) -> T {
        ptr::read(self.ptr)
    }

    /// Read without alignment requirements.
    ///
    /// # Safety
    ///
    /// Same requirements as `VmPtr::read_unaligned`.
    #[inline]
    pub unsafe fn read_unaligned(self) -> T {
        ptr::read_unaligned(self.ptr)
    }

    /// Write a value to this pointer.
    ///
    /// # Safety
    ///
    /// - The pointer must be properly aligned for `T`
    /// - The memory must be writable
    /// - The memory must not be concurrently accessed
    #[inline]
    pub unsafe fn write(self, val: T) {
        ptr::write(self.ptr, val);
    }

    /// Write a value without alignment requirements.
    ///
    /// # Safety
    ///
    /// Same as `write` except alignment.
    #[inline]
    pub unsafe fn write_unaligned(self, val: T) {
        ptr::write_unaligned(self.ptr, val);
    }

    /// Cast to a pointer of a different type.
    #[inline]
    pub fn cast<U>(self) -> VmPtrMut<U> {
        VmPtrMut {
            ptr: self.ptr.cast(),
            _marker: PhantomData,
        }
    }

    /// Convert to immutable.
    #[inline]
    pub fn as_const(self) -> VmPtr<T> {
        VmPtr {
            ptr: self.ptr,
            _marker: PhantomData,
        }
    }

    /// Check if null.
    #[inline]
    pub fn is_null(self) -> bool {
        self.ptr.is_null()
    }
}

/// Compute a VM segment address from its components.
///
/// The address format is:
/// ```text
/// | seg_type (8 bits) | seg_idx (16 bits) | offset (24 bits) |
/// ```
#[inline]
pub const fn compute_segment_addr(seg_type: usize, seg_idx: usize, offset: usize) -> usize {
    (seg_type << 40) | (seg_idx << 24) | offset
}

/// Provenance-safe memory copy.
///
/// This function copies `count` bytes from `src` to `dest`, preserving proper
/// pointer provenance throughout the operation. Unlike `memcpy` from libc,
/// this function is designed to work correctly with Rust's strict provenance
/// model.
///
/// # Safety
///
/// - `src` must be valid for reads of `count` bytes
/// - `dest` must be valid for writes of `count` bytes
/// - Both pointers must have valid provenance over their respective regions
/// - The regions must not overlap (use `copy_overlapping` for that)
///
/// # Example
///
/// ```rust
/// use thru_core::provenance::{VmPtr, VmPtrMut, copy_nonoverlapping};
///
/// unsafe {
///     let src = VmPtr::from_raw(data.as_ptr());
///     let dest = VmPtrMut::from_raw(buffer.as_mut_ptr());
///     copy_nonoverlapping(src, dest, data.len());
/// }
/// ```
#[inline]
pub unsafe fn copy_nonoverlapping(src: VmPtr<u8>, dest: VmPtrMut<u8>, count: usize) {
    // Use the standard library's copy_nonoverlapping which properly handles
    // provenance. The pointers we pass in already have correct provenance
    // from VmPtr/VmPtrMut construction.
    ptr::copy_nonoverlapping(src.as_ptr(), dest.as_mut_ptr(), count);
}

/// Provenance-safe memory copy that handles overlapping regions.
///
/// # Safety
///
/// Same as `copy_nonoverlapping` except overlapping is allowed.
#[inline]
pub unsafe fn copy(src: VmPtr<u8>, dest: VmPtrMut<u8>, count: usize) {
    ptr::copy(src.as_ptr(), dest.as_mut_ptr(), count);
}

/// Byte-by-byte memory copy with explicit provenance tracking.
///
/// This is a fallback implementation for environments where `ptr::copy_nonoverlapping`
/// is not available. It performs the copy one byte at a time, deriving new pointers
/// for each access to maintain proper provenance.
///
/// # Safety
///
/// Same requirements as `copy_nonoverlapping`.
///
/// # Performance Note
///
/// This function is intentionally not optimized to ensure correctness under
/// strict provenance. Use `copy_nonoverlapping` when possible for better
/// performance.
#[inline(never)]
pub unsafe fn copy_bytes_strict(src: VmPtr<u8>, dest: VmPtrMut<u8>, count: usize) {
    // Each iteration derives a new pointer from the base, which is the correct
    // way to access different offsets while preserving provenance.
    for i in 0..count {
        let src_byte = src.byte_add(i);
        let dest_byte = dest.byte_add(i);
        let val = src_byte.read();
        dest_byte.write(val);
    }
}

/// Fill memory with a byte value.
///
/// # Safety
///
/// - `dest` must be valid for writes of `count` bytes
/// - `dest` must have valid provenance
#[inline]
pub unsafe fn memset(dest: VmPtrMut<u8>, val: u8, count: usize) {
    for i in 0..count {
        dest.byte_add(i).write(val);
    }
}

/// Create a slice from a VM pointer.
///
/// # Safety
///
/// - The pointer must be valid for reads of `len * size_of::<T>()` bytes
/// - The memory must be initialized with valid `T` values
/// - The pointer must be properly aligned for `T`
/// - The total size must not exceed `isize::MAX`
#[inline]
pub unsafe fn slice_from_vm_ptr<'a, T>(ptr: VmPtr<T>, len: usize) -> &'a [T] {
    core::slice::from_raw_parts(ptr.as_ptr(), len)
}

/// Create a mutable slice from a VM pointer.
///
/// # Safety
///
/// Same as `slice_from_vm_ptr` plus:
/// - The memory must be writable
/// - No other references to this memory may exist
#[inline]
pub unsafe fn slice_from_vm_ptr_mut<'a, T>(ptr: VmPtrMut<T>, len: usize) -> &'a mut [T] {
    core::slice::from_raw_parts_mut(ptr.as_mut_ptr(), len)
}


