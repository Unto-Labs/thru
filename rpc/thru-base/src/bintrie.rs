use sha2::{Digest, Sha256};
use tracing::debug;

use crate::{
    NonExistenceProof, Proof,
    bintrie_error::BinTrieError,
    bintrie_types::{Hash, Pubkey},
};

/// A key-value pair in the trie
#[derive(Debug, Clone, PartialEq)]
pub struct BinTriePair {
    pub pubkey: Pubkey,
    pub value_hash: Hash,
    pub is_sibling_hash: bool,
}

impl BinTriePair {
    pub fn new(pubkey: Pubkey, value_hash: Hash) -> Self {
        Self {
            pubkey,
            value_hash,
            is_sibling_hash: false,
        }
    }

    pub fn new_sibling_hash(sibling_hash: Hash) -> Self {
        Self {
            pubkey: Pubkey::default(),
            value_hash: sibling_hash,
            is_sibling_hash: true,
        }
    }
}

/// Leaf node in the binary trie
#[derive(Debug, Clone, PartialEq)]
pub struct BinTrieLeaf {
    pub hash: Hash,
    pub pair: BinTriePair,
}

impl BinTrieLeaf {
    pub fn new(pair: BinTriePair) -> Self {
        let mut leaf = Self {
            hash: Hash::default(),
            pair,
        };
        leaf.compute_hash();
        leaf
    }

    /// Compute the hash of this leaf according to the C implementation
    pub fn compute_hash(&mut self) {
        if self.pair.is_sibling_hash {
            self.hash = self.pair.value_hash;
        } else {
            let mut hasher = Sha256::new();
            hasher.update(&[0x00]); // Leaf prefix
            hasher.update(self.pair.pubkey.as_bytes());
            hasher.update(self.pair.value_hash.as_bytes());
            let result = hasher.finalize();
            self.hash = Hash::new(result.into());
        }
    }
}

/// Internal node in the binary trie
#[derive(Debug, Clone, PartialEq)]
pub struct BinTrieNode {
    pub hash: Hash,
    pub bit_idx: u8,
    pub left: Option<Box<BinTrieElement>>,
    pub right: Option<Box<BinTrieElement>>,
}

impl BinTrieNode {
    pub fn new(bit_idx: u8) -> Self {
        Self {
            hash: Hash::default(),
            bit_idx,
            left: None,
            right: None,
        }
    }

    /// Compute the hash of this node according to the C implementation
    pub fn compute_hash(&mut self) {
        let left_hash = self
            .left
            .as_ref()
            .map(|e| e.hash())
            .unwrap_or(Hash::default());
        let right_hash = self
            .right
            .as_ref()
            .map(|e| e.hash())
            .unwrap_or(Hash::default());

        let mut hasher = Sha256::new();
        hasher.update(&[0x01]); // Internal node prefix
        hasher.update(left_hash.as_bytes());
        hasher.update(right_hash.as_bytes());
        let result = hasher.finalize();
        self.hash = Hash::new(result.into());
    }
}

/// Element in the binary trie (either a node or a leaf)
#[derive(Debug, Clone, PartialEq)]
pub enum BinTrieElement {
    Node(BinTrieNode),
    Leaf(BinTrieLeaf),
}

impl BinTrieElement {
    pub fn hash(&self) -> Hash {
        match self {
            BinTrieElement::Node(node) => node.hash,
            BinTrieElement::Leaf(leaf) => leaf.hash,
        }
    }

    pub fn compute_hash(&mut self) {
        match self {
            BinTrieElement::Node(node) => node.compute_hash(),
            BinTrieElement::Leaf(leaf) => leaf.compute_hash(),
        }
    }

    pub fn is_leaf(&self) -> bool {
        matches!(self, BinTrieElement::Leaf(_))
    }

    pub fn is_node(&self) -> bool {
        matches!(self, BinTrieElement::Node(_))
    }
}

/// Binary prefix trie with a fixed, 256-bit key
///
/// This is the main data structure that provides a binary prefix trie
/// with SHA256-based hash caching. Unlike the C implementation that uses
/// manual memory management, this Rust version uses standard collections
/// and recursive data structures for memory safety and idiomatic design.
#[derive(Debug, Clone, PartialEq)]
pub struct BinTrie {
    root: Option<Box<BinTrieElement>>,
}

impl Default for BinTrie {
    fn default() -> Self {
        Self::new()
    }
}

impl BinTrie {
    /// Create a new empty binary trie
    pub fn new() -> Self {
        Self { root: None }
    }

    /// Check if the trie is empty
    pub fn is_empty(&self) -> bool {
        self.root.is_none()
    }

    /// Get the state root hash of the entire trie
    pub fn state_root(&self) -> Hash {
        self.root
            .as_ref()
            .map(|r| r.hash())
            .unwrap_or(Hash::default())
    }

    /// Query for a key in the trie
    pub fn query(&self, pubkey: &Pubkey) -> Option<&BinTriePair> {
        let mut current = self.root.as_ref()?;

        // Traverse down to a leaf
        loop {
            match current.as_ref() {
                BinTrieElement::Leaf(leaf) => {
                    if leaf.pair.pubkey == *pubkey {
                        return Some(&leaf.pair);
                    } else {
                        return None;
                    }
                }
                BinTrieElement::Node(node) => {
                    let go_right = pubkey.get_bit(node.bit_idx);
                    current = if go_right {
                        node.right.as_ref()?
                    } else {
                        node.left.as_ref()?
                    };
                }
            }
        }
    }

    /// Insert a new key-value pair into the trie
    pub fn insert(&mut self, pubkey: Pubkey, value_hash: Hash) -> Result<(), BinTrieError> {
        // Handle empty trie case
        if self.root.is_none() {
            let pair = BinTriePair::new(pubkey, value_hash);
            self.root = Some(Box::new(BinTrieElement::Leaf(BinTrieLeaf::new(pair))));
            return Ok(());
        }

        // Check for duplicate key first
        if self.query(&pubkey).is_some() {
            return Err(BinTrieError::KeyExists);
        }

        // Traverse to a leaf, collecting path nodes
        let mut path_nodes: Vec<(u8, bool)> = Vec::new(); // (bit_idx, go_right)
        let existing_pubkey = {
            let mut current = self.root.as_ref().unwrap();
            loop {
                match current.as_ref() {
                    BinTrieElement::Leaf(leaf) => break leaf.pair.pubkey,
                    BinTrieElement::Node(node) => {
                        let go_right = pubkey.get_bit(node.bit_idx);
                        path_nodes.push((node.bit_idx, go_right));
                        current = if go_right {
                            node.right.as_ref().unwrap()
                        } else {
                            node.left.as_ref().unwrap()
                        };
                    }
                }
            }
        };

        // Find split index (first bit where keys differ)
        let mut split_idx = 0u8;
        for bit_idx in 0..=255 {
            if pubkey.get_bit(bit_idx) != existing_pubkey.get_bit(bit_idx) {
                split_idx = bit_idx;
                break;
            }
        }

        // Backtrack to find where to insert the new node
        // Find the deepest node whose bit_idx < split_idx
        let mut parent_depth = None;
        for (i, &(bit_idx, _)) in path_nodes.iter().enumerate().rev() {
            if bit_idx < split_idx {
                parent_depth = Some(i);
                break;
            }
        }

        // Create new leaf for the new key
        let new_pair = BinTriePair::new(pubkey, value_hash);
        let new_leaf = BinTrieLeaf::new(new_pair);

        // Create new internal node at split_idx
        let mut new_node = BinTrieNode::new(split_idx);
        let new_key_goes_right = pubkey.get_bit(split_idx);

        if let Some(parent_idx) = parent_depth {
            // There's a parent - we need to insert the new node as a child of that parent
            let (_, parent_go_right) = path_nodes[parent_idx];

            // Navigate to the parent and extract its child subtree
            let child_subtree = {
                let mut current = self.root.as_mut().unwrap();
                for &(_, go_right) in &path_nodes[0..parent_idx] {
                    current = match current.as_mut() {
                        BinTrieElement::Node(node) => {
                            if go_right {
                                node.right.as_mut().unwrap()
                            } else {
                                node.left.as_mut().unwrap()
                            }
                        }
                        _ => unreachable!(),
                    };
                }

                // Now current is at the parent, extract the child
                match current.as_mut() {
                    BinTrieElement::Node(parent_node) => {
                        if parent_go_right {
                            parent_node.right.take().unwrap()
                        } else {
                            parent_node.left.take().unwrap()
                        }
                    }
                    _ => unreachable!(),
                }
            };

            // Set up the new node's children
            if new_key_goes_right {
                new_node.left = Some(child_subtree);
                new_node.right = Some(Box::new(BinTrieElement::Leaf(new_leaf)));
            } else {
                new_node.left = Some(Box::new(BinTrieElement::Leaf(new_leaf)));
                new_node.right = Some(child_subtree);
            }
            new_node.compute_hash();

            // Insert the new node back as the parent's child
            {
                let mut current = self.root.as_mut().unwrap();
                for &(_, go_right) in &path_nodes[0..parent_idx] {
                    current = match current.as_mut() {
                        BinTrieElement::Node(node) => {
                            if go_right {
                                node.right.as_mut().unwrap()
                            } else {
                                node.left.as_mut().unwrap()
                            }
                        }
                        _ => unreachable!(),
                    };
                }

                // Now current is at the parent, set the child
                match current.as_mut() {
                    BinTrieElement::Node(parent_node) => {
                        if parent_go_right {
                            parent_node.right = Some(Box::new(BinTrieElement::Node(new_node)));
                        } else {
                            parent_node.left = Some(Box::new(BinTrieElement::Node(new_node)));
                        }
                    }
                    _ => unreachable!(),
                }
            }

            // Update hashes up the path to root
            for depth in (0..=parent_idx).rev() {
                let mut current = self.root.as_mut().unwrap();
                for &(_, go_right) in &path_nodes[0..depth] {
                    current = match current.as_mut() {
                        BinTrieElement::Node(node) => {
                            if go_right {
                                node.right.as_mut().unwrap()
                            } else {
                                node.left.as_mut().unwrap()
                            }
                        }
                        _ => unreachable!(),
                    };
                }

                match current.as_mut() {
                    BinTrieElement::Node(node) => {
                        node.compute_hash();
                    }
                    _ => break,
                }
            }
        } else {
            // Insert at root level - the entire current tree becomes one child
            let existing_tree = self.root.take().unwrap();

            if new_key_goes_right {
                new_node.left = Some(existing_tree);
                new_node.right = Some(Box::new(BinTrieElement::Leaf(new_leaf)));
            } else {
                new_node.left = Some(Box::new(BinTrieElement::Leaf(new_leaf)));
                new_node.right = Some(existing_tree);
            }
            new_node.compute_hash();
            self.root = Some(Box::new(BinTrieElement::Node(new_node)));
        }

        Ok(())
    }

    /// Update the hash for an existing key
    pub fn update_hash(
        &mut self,
        pubkey: &Pubkey,
        new_value_hash: Hash,
    ) -> Result<(), BinTrieError> {
        Self::update_hash_recursive(&mut self.root, pubkey, new_value_hash)
    }

    fn update_hash_recursive(
        current: &mut Option<Box<BinTrieElement>>,
        pubkey: &Pubkey,
        new_value_hash: Hash,
    ) -> Result<(), BinTrieError> {
        let current_element = current.as_mut().ok_or(BinTrieError::KeyNotFound)?;

        match current_element.as_mut() {
            BinTrieElement::Leaf(leaf) => {
                if leaf.pair.pubkey == *pubkey {
                    leaf.pair.value_hash = new_value_hash;
                    leaf.compute_hash();
                    Ok(())
                } else {
                    Err(BinTrieError::KeyNotFound)
                }
            }
            BinTrieElement::Node(node) => {
                let go_right = pubkey.get_bit(node.bit_idx);
                let child = if go_right {
                    &mut node.right
                } else {
                    &mut node.left
                };

                Self::update_hash_recursive(child, pubkey, new_value_hash)?;
                node.compute_hash();
                Ok(())
            }
        }
    }

    /// Generate a proof of existence for a key
    pub fn prove_existence(&self, pubkey: &Pubkey) -> Result<(Proof, Hash), BinTrieError> {
        let mut proof = Proof::new();
        let mut current = self.root.as_ref().ok_or(BinTrieError::KeyNotFound)?;

        // Traverse to the leaf, collecting sibling hashes
        loop {
            match current.as_ref() {
                BinTrieElement::Leaf(leaf) => {
                    if leaf.pair.pubkey == *pubkey {
                        return Ok((proof, leaf.pair.value_hash));
                    } else {
                        return Err(BinTrieError::KeyNotFound);
                    }
                }
                BinTrieElement::Node(node) => {
                    let go_right = pubkey.get_bit(node.bit_idx);
                    proof.proof_indices.push(node.bit_idx);

                    if go_right {
                        // Going right, collect left sibling
                        let sibling_hash = node
                            .left
                            .as_ref()
                            .map(|e| e.hash())
                            .unwrap_or(Hash::default());
                        proof.sibling_hashes.push(sibling_hash);
                        current = node.right.as_ref().ok_or(BinTrieError::KeyNotFound)?;
                    } else {
                        // Going left, collect right sibling
                        let sibling_hash = node
                            .right
                            .as_ref()
                            .map(|e| e.hash())
                            .unwrap_or(Hash::default());
                        proof.sibling_hashes.push(sibling_hash);
                        current = node.left.as_ref().ok_or(BinTrieError::KeyNotFound)?;
                    }
                }
            }
        }
    }

    /// Generate a proof of non-existence for a key
    pub fn prove_non_existence(&self, pubkey: &Pubkey) -> Result<NonExistenceProof, BinTrieError> {
        // Empty trie proves non-existence of any key
        if self.root.is_none() {
            return Ok(NonExistenceProof {
                proof: Proof::new(),
                existing_pubkey: Pubkey::default(),
                existing_hash: Hash::default(),
            });
        }

        let mut proof = Proof::new();
        let mut current = self.root.as_ref().unwrap();

        // Traverse to a leaf, collecting sibling hashes
        loop {
            match current.as_ref() {
                BinTrieElement::Leaf(leaf) => {
                    if leaf.pair.pubkey == *pubkey {
                        return Err(BinTrieError::KeyExists);
                    } else {
                        return Ok(NonExistenceProof {
                            proof,
                            existing_pubkey: leaf.pair.pubkey,
                            existing_hash: leaf.pair.value_hash,
                        });
                    }
                }
                BinTrieElement::Node(node) => {
                    // Use the node's bit_idx like the C implementation
                    let bit_idx = node.bit_idx;
                    let go_right = pubkey.get_bit(bit_idx);
                    proof.proof_indices.push(bit_idx);

                    if go_right {
                        let sibling_hash = node
                            .left
                            .as_ref()
                            .map(|e| e.hash())
                            .unwrap_or(Hash::default());
                        proof.sibling_hashes.push(sibling_hash);
                        current = node.right.as_ref().unwrap();
                    } else {
                        let sibling_hash = node
                            .right
                            .as_ref()
                            .map(|e| e.hash())
                            .unwrap_or(Hash::default());
                        proof.sibling_hashes.push(sibling_hash);
                        current = node.left.as_ref().unwrap();
                    }
                }
            }
        }
    }

    /// Insert a key with a proof of existence
    pub fn insert_with_proof(
        &mut self,
        pubkey: Pubkey,
        value_hash: Hash,
        proof: &Proof,
    ) -> Result<(), BinTrieError> {
        // For empty trie with empty proof, just insert
        if self.root.is_none() && proof.proof_indices.is_empty() {
            return self.insert(pubkey, value_hash);
        }

        // Build the path according to the proof
        self.insert_with_proof_recursive(pubkey, value_hash, proof, 0)
    }

    fn insert_with_proof_recursive(
        &mut self,
        pubkey: Pubkey,
        value_hash: Hash,
        proof: &Proof,
        depth: usize,
    ) -> Result<(), BinTrieError> {
        if depth >= proof.proof_indices.len() {
            // Create the final leaf
            let pair = BinTriePair::new(pubkey, value_hash);
            self.root = Some(Box::new(BinTrieElement::Leaf(BinTrieLeaf::new(pair))));
            return Ok(());
        }

        let bit_idx = proof.proof_indices[depth];
        let sibling_hash = proof.sibling_hashes[depth];
        let go_right = pubkey.get_bit(bit_idx);

        // Create internal node
        let mut node = BinTrieNode::new(bit_idx);

        // Create sibling leaf with the provided hash
        let sibling_pair = BinTriePair::new_sibling_hash(sibling_hash);
        let sibling_leaf = BinTrieLeaf::new(sibling_pair);

        if depth + 1 < proof.proof_indices.len() {
            // More depth to go, create another subtree
            let mut subtrie = BinTrie::new();
            subtrie.insert_with_proof_recursive(pubkey, value_hash, proof, depth + 1)?;

            if go_right {
                node.left = Some(Box::new(BinTrieElement::Leaf(sibling_leaf)));
                node.right = subtrie.root;
            } else {
                node.left = subtrie.root;
                node.right = Some(Box::new(BinTrieElement::Leaf(sibling_leaf)));
            }
        } else {
            // Final level, create the actual leaf
            let pair = BinTriePair::new(pubkey, value_hash);
            let new_leaf = BinTrieLeaf::new(pair);

            if go_right {
                node.left = Some(Box::new(BinTrieElement::Leaf(sibling_leaf)));
                node.right = Some(Box::new(BinTrieElement::Leaf(new_leaf)));
            } else {
                node.left = Some(Box::new(BinTrieElement::Leaf(new_leaf)));
                node.right = Some(Box::new(BinTrieElement::Leaf(sibling_leaf)));
            }
        }

        node.compute_hash();
        self.root = Some(Box::new(BinTrieElement::Node(node)));
        Ok(())
    }

    /// Insert a key with proof of creation (includes existing key proof)
    pub fn insert_with_creation_proof(
        &mut self,
        pubkey: Pubkey,
        value_hash: Hash,
        existing_pubkey: Pubkey,
        existing_value_hash: Hash,
        proof: &Proof,
    ) -> Result<(), BinTrieError> {
        // For empty trie with empty proof, just insert both keys
        if self.root.is_none() && proof.proof_indices.is_empty() {
            // Insert existing key first
            self.insert(existing_pubkey, existing_value_hash)?;
            // Then insert new key
            self.insert(pubkey, value_hash)?;
            return Ok(());
        }

        // First insert the existing key with proof if trie is not empty or proof is not empty
        if self.root.is_some() || !proof.proof_indices.is_empty() {
            match self.insert_with_proof(existing_pubkey, existing_value_hash, proof) {
                Ok(()) => {}
                Err(BinTrieError::KeyExists) => {} // Already exists, that's fine for creation proof
                Err(e) => return Err(e),
            }
        }

        // Then insert the new key normally
        self.insert(pubkey, value_hash)
    }

    /// Print a compact representation of the trie
    pub fn print(&self) {
        println!("Binary Trie:");
        if let Some(root) = &self.root {
            self.print_element(root, 1);
        } else {
            println!("  (Empty trie)");
        }
    }

    /// Print a verbose representation of the trie
    pub fn print_verbose(&self) {
        println!("Binary Trie (Verbose):");
        println!("  Root hash: {}", self.state_root());
        if let Some(root) = &self.root {
            self.print_element_verbose(root, 1);
        } else {
            println!("  (Empty trie)");
        }
    }

    fn print_element(&self, element: &BinTrieElement, depth: usize) {
        let indent = "  ".repeat(depth);

        match element {
            BinTrieElement::Leaf(leaf) => {
                if leaf.pair.is_sibling_hash {
                    println!("{}S {}", indent, leaf.hash);
                } else {
                    println!("{}L {}", indent, leaf.pair.pubkey);
                }
            }
            BinTrieElement::Node(node) => {
                println!("{}N bit={}", indent, node.bit_idx);
                if let Some(left) = &node.left {
                    self.print_element(left, depth + 1);
                }
                if let Some(right) = &node.right {
                    self.print_element(right, depth + 1);
                }
            }
        }
    }

    fn print_element_verbose(&self, element: &BinTrieElement, depth: usize) {
        let indent = "  ".repeat(depth);

        match element {
            BinTrieElement::Leaf(leaf) => {
                if leaf.pair.is_sibling_hash {
                    println!("{}Leaf: SIBLING HASH: {}", indent, leaf.hash);
                } else {
                    println!(
                        "{}Leaf: KEY: {:?}, VALUE HASH: {}, LEAF HASH: {}",
                        indent, leaf.pair.pubkey, leaf.pair.value_hash, leaf.hash
                    );
                }
            }
            BinTrieElement::Node(node) => {
                println!(
                    "{}Node: bit_idx={}, HASH: {}",
                    indent, node.bit_idx, node.hash
                );
                println!("{}Left:", indent);
                if let Some(left) = &node.left {
                    self.print_element_verbose(left, depth + 1);
                } else {
                    println!("{}  (null)", indent);
                }
                println!("{}Right:", indent);
                if let Some(right) = &node.right {
                    self.print_element_verbose(right, depth + 1);
                } else {
                    println!("{}  (null)", indent);
                }
            }
        }
    }

    /// Print a verbose representation of the trie
    pub fn print_log_verbose(&self) {
        debug!("Binary Trie (Verbose):");
        debug!("  Root hash: {}", self.state_root());
        if let Some(root) = &self.root {
            self.print_element_log_verbose(root, 1);
        } else {
            debug!("  (Empty trie)");
        }
    }

    fn print_element_log_verbose(&self, element: &BinTrieElement, depth: usize) {
        let indent = "  ".repeat(depth);

        match element {
            BinTrieElement::Leaf(leaf) => {
                if leaf.pair.is_sibling_hash {
                    debug!("{}Leaf: SIBLING HASH: {}", indent, leaf.hash);
                } else {
                    debug!(
                        "{}Leaf: KEY: {}, VALUE HASH: {}, LEAF HASH: {}",
                        indent, leaf.pair.pubkey, leaf.pair.value_hash, leaf.hash
                    );
                }
            }
            BinTrieElement::Node(node) => {
                debug!(
                    "{}Node: bit_idx={}, HASH: {}",
                    indent, node.bit_idx, node.hash
                );
                debug!("{}Left:", indent);
                if let Some(left) = &node.left {
                    self.print_element_log_verbose(left, depth + 1);
                } else {
                    debug!("{}  (null)", indent);
                }
                debug!("{}Right:", indent);
                if let Some(right) = &node.right {
                    self.print_element_log_verbose(right, depth + 1);
                } else {
                    debug!("{}  (null)", indent);
                }
            }
        }
    }
}

/// Helper functions for testing that match the C implementation
pub mod test_helpers {
    use super::*;

    /// Hash a leaf node according to the C implementation
    pub fn hash_leaf(pubkey: &Pubkey, value_hash: &Hash) -> Hash {
        let mut hasher = Sha256::new();
        hasher.update(&[0x00]);
        hasher.update(pubkey.as_bytes());
        hasher.update(value_hash.as_bytes());
        let result = hasher.finalize();
        Hash::new(result.into())
    }

    /// Hash an internal node according to the C implementation
    pub fn hash_node(left_hash: &Hash, right_hash: &Hash) -> Hash {
        let mut hasher = Sha256::new();
        hasher.update(&[0x01]);
        hasher.update(left_hash.as_bytes());
        hasher.update(right_hash.as_bytes());
        let result = hasher.finalize();
        Hash::new(result.into())
    }
}
