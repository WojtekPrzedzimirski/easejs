/**
 * Provides system for code reuse via traits
 *
 *  Copyright (C) 2014 Mike Gerwitz
 *
 *  This file is part of GNU ease.js.
 *
 *  ease.js is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

var AbstractClass = require( __dirname + '/class_abstract' ),
    ClassBuilder  = require( __dirname + '/ClassBuilder' );


function Trait()
{
    switch ( arguments.length )
    {
        case 1:
            return Trait.extend.apply( this, arguments );
            break;
    }
};


Trait.extend = function( dfn )
{
    // we need at least one abstract member in order to declare a class as
    // abstract (in this case, our trait class), so let's create a dummy one
    // just in case DFN does not contain any abstract members itself
    dfn[ 'abstract protected ___$$trait$$' ] = [];

    // give the abstract trait class a distinctive name for debugging
    dfn.__name = '#AbstractTrait#';

    function TraitType()
    {
        throw Error( "Cannot instantiate trait" );
    };

    // and here we can see that traits are quite literally abstract classes
    var tclass = AbstractClass( dfn );

    TraitType.__trait = true;
    TraitType.__acls  = tclass;
    TraitType.__ccls  = null;

    // traits are not permitted to define constructors
    if ( tclass.___$$methods$$['public'].__construct !== undefined )
    {
        throw Error( "Traits may not define __construct" );
    }

    // invoked to trigger mixin
    TraitType.__mixin = function( dfn )
    {
        mixin( TraitType, dfn );
    };

    return TraitType;
};


Trait.isTrait = function( trait )
{
    return !!( trait || {} ).__trait;
};


/**
 * Create a concrete class from the abstract trait class
 *
 * This class is the one that will be instantiated by classes that mix in
 * the trait.
 *
 * @param  {AbstractClass}  acls  abstract trait class
 *
 * @return  {Class}  concrete trait class for instantiation
 */
function createConcrete( acls )
{
    // start by providing a concrete implementation for our dummy method and
    // a constructor that accepts the protected member object of the
    // containing class
    var dfn = {
        'protected ___$$trait$$': function() {},

        // protected member object
        'private ___$$pmo$$': null,
        __construct: function( pmo )
        {
            this.___$$pmo$$ = pmo;
        },

        // mainly for debugging; should really never see this.
        __name: '#ConcreteTrait#',
    };

    // every abstract method should be overridden with a proxy to the
    // protected member object that will be passed in via the ctor
    var amethods = ClassBuilder.getMeta( acls ).abstractMethods;
    for ( var f in amethods )
    {
        // TODO: would be nice if this check could be for '___'; need to
        // replace amethods.__length with something else, then
        if ( !( Object.hasOwnProperty.call( amethods, f ) )
            || ( f.substr( 0, 2 ) === '__' )
        )
        {
            continue;
        }

        // we know that if it's not public, then it must be protected
        var vis = ( acls.___$$methods$$['public'][ f ] !== undefined )
            ? 'public'
            : 'protected';

        // setting the correct visibility modified is important to prevent
        // visibility de-escalation errors if a protected concrete method is
        // provided
        dfn[ vis + ' proxy ' + f ] = '___$$pmo$$';
    }

    // virtual methods need to be handled with care to ensure that we invoke
    // any overrides
    createVirtProxy( acls, dfn );

    return acls.extend( dfn );
}


/**
 * Create virtual method proxies for all virtual members
 *
 * Virtual methods are a bit of hassle with traits: we are in a situation
 * where we do not know at the time that the trait is created whether or not
 * the virtual method has been overridden, since the class that the trait is
 * mixed into may do the overriding. Therefore, we must check if an override
 * has occured *when the method is invoked*; there is room for optimization
 * there (by making such a determination at the time of mixin), but we'll
 * leave that for later.
 *
 * @param  {AbstractClass}  acls  abstract trait class
 * @param  {Object}         dfn   destination definition object
 *
 * @return  {undefined}
 */
function createVirtProxy( acls, dfn )
{
    var vmembers = ClassBuilder.getMeta( acls ).virtualMembers;

    // f = `field'
    for ( var f in vmembers )
    {
        var vis = ( acls.___$$methods$$['public'][ f ] !== undefined )
            ? 'public'
            : 'protected';

        dfn[ vis + ' virtual override ' + f ] = ( function()
        {
            // this is the aforementioned proxy method; see the docblock for
            // more information
            return function()
            {
                var pmo = this.___$$pmo$$,
                    o   = pmo[ f ],
                    op  = o.___$$proxy_to$$;

                // XXX: a better way to do this would be nice, since this
                // does a substring check on every call; avoids infinite
                // recursion from proxying to self
                return ( o && !( op && op.substr( 0, 7 ) === '___$to$' ) )
                    ? pmo[ f ].apply( pmo, arguments )
                    : this.__super.apply( this, arguments );
            }
        } )( f );
    }
}


/**
 * Mix trait into the given definition
 *
 * The original object DFN is modified; it is not cloned.
 *
 * @param  {Trait}   trait  trait to mix in
 * @param  {Object}  dfn    definition object to merge into
 *
 * @return  {Object}  dfn
 */
function mixin( trait, dfn )
{
    // the abstract class hidden within the trait
    var acls    = trait.__acls,
        methods = acls.___$$methods$$;

    // retrieve the private member name that will contain this trait object
    var iname = addTraitInst( trait, dfn );

    mixMethods( methods['public'], dfn, 'public', iname );
    mixMethods( methods['protected'], dfn, 'protected', iname );

    return dfn;
}


/**
 * Mix methods from SRC into DEST using proxies
 *
 * @param  {Object}  src    visibility object to scavenge from
 * @param  {Object}  dest   destination definition object
 * @param  {string}  vis    visibility modifier
 * @param  {string}  ianem  proxy destination (trait instance)
 *
 * @return  {undefined}
 */
function mixMethods( src, dest, vis, iname )
{
    for ( var f in src )
    {
        if ( !( Object.hasOwnProperty.call( src, f ) ) )
        {
            continue;
        }

        // TODO: this is a kluge; we'll use proper reflection eventually,
        // but for now, this is how we determine if this is an actual method
        // vs. something that just happens to be on the visibility object
        if ( !( src[ f ].___$$keywords$$ ) || f === '___$$trait$$' )
        {
            continue;
        }

        var keywords = src[ f ].___$$keywords$$,
            vis      = keywords['protected'] ? 'protected' : 'public';

        // if abstract, then we are expected to provide the implementation;
        // otherwise, we proxy to the trait's implementation
        if ( keywords['abstract'] )
        {
            // copy the abstract definition (N.B. this does not copy the
            // param names, since that is not [yet] important); the
            // visibility modified is important to prevent de-escalation
            // errors on override
            dest[ vis + ' weak abstract ' + f ] = src[ f ].definition;
        }
        else
        {
            var virt  = keywords['virtual'] ? 'weak virtual ' : '',
                pname = virt + vis + ' proxy ' + f;

            // if we have already set up a proxy for a field of this name,
            // then multiple traits have defined the same concrete member
            if ( dest[ pname ] !== undefined )
            {
                // TODO: between what traits?
                throw Error( "Trait member conflict: `" + f + "'" );
            }

            // proxy this method to what will be the encapsulated trait
            // object
            dest[ pname ] = iname;
        }
    }
}


/**
 * Add concrete trait class to a class instantion list
 *
 * This list---which will be created if it does not already exist---will be
 * used upon instantiation of the class consuming DFN to instantiate the
 * concrete trait classes.
 *
 * Here, `tc' and `to' are understood to be, respectively, ``trait class''
 * and ``trait object''.
 *
 * @param  {Class}   T    trait
 * @param  {Object}  dfn  definition object of class being mixed into
 *
 * @return  {string}  private member into which C instance shall be stored
 */
function addTraitInst( T, dfn )
{
    var tc    = ( dfn.___$$tc$$ = ( dfn.___$$tc$$ || [] ) ),
        iname = '___$to$' + tc.length;

    // the trait object array will contain two values: the destination field
    // and the trait to instantiate
    tc.push( [ iname, T ] );

    // we must also add the private field to the definition object to
    // support the object assignment indicated by TC
    dfn[ 'private ' + iname ] = null;

    // create internal trait ctor if not available
    if ( dfn.___$$tctor$$ === undefined )
    {
        dfn.___$$tctor$$ = tctor;
    }

    return iname;
}


/**
 * Trait initialization constructor
 *
 * May be used to initialize all traits mixed into the class that invokes
 * this function. All concrete trait classes are instantiated and their
 * resulting objects assigned to their rsepective pre-determined field
 * names.
 *
 * This will lazily create the concrete trait class if it does not already
 * exist, which saves work if the trait is never used.
 *
 * @return  {undefined}
 */
function tctor()
{
    // instantiate all traits and assign the object to their
    // respective fields
    var tc = this.___$$tc$$;
    for ( var t in tc )
    {
        var f = tc[ t ][ 0 ],
            T = tc[ t ][ 1 ],
            C = T.__ccls || ( T.__ccls = createConcrete( T.__acls ) );

        // instantiate the trait, providing it with our protected visibility
        // object so that it has access to our public and protected members
        // (but not private); in return, we will use its own protected
        // visibility object to gain access to its protected members...quite
        // the intimate relationship
        this[ f ] = C( this.___$$vis$$ ).___$$vis$$;
    }
};


module.exports = Trait;